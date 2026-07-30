const { PDFDocument, degrees } = require('pdf-lib');
const archiver = require('archiver');
const { PassThrough } = require('stream');
const pdfUtils = require('../utils/pdfUtils');

// Helper to parse page range string like "1-3, 5, 8-10" into arrays of 0-indexed page numbers
const parseRanges = (rangeString, maxPages) => {
  const pages = [];
  const segments = rangeString.split(',');

  for (const segment of segments) {
    const clean = segment.trim();
    if (!clean) continue;

    if (clean.includes('-')) {
      const [startStr, endStr] = clean.split('-');
      const start = Math.max(1, parseInt(startStr, 10));
      const end = Math.min(maxPages, parseInt(endStr, 10));

      if (!isNaN(start) && !isNaN(end) && start <= end) {
        for (let i = start; i <= end; i++) {
          pages.push(i - 1); // convert to 0-index
        }
      }
    } else {
      const pageNum = parseInt(clean, 10);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= maxPages) {
        pages.push(pageNum - 1);
      }
    }
  }

  // Remove duplicates and sort ascending
  return [...new Set(pages)].sort((a, b) => a - b);
};

// Helper to parse individual range groups e.g. "1-3, 5" returns [ { label: '1-3', indices: [0,1,2] }, { label: '5', indices: [4] } ]
const parseRangeGroups = (rangeString, maxPages) => {
  const groups = [];
  const segments = rangeString.split(',');

  for (const segment of segments) {
    const clean = segment.trim();
    if (!clean) continue;

    if (clean.includes('-')) {
      const [startStr, endStr] = clean.split('-');
      const start = Math.max(1, parseInt(startStr, 10));
      const end = Math.min(maxPages, parseInt(endStr, 10));

      if (!isNaN(start) && !isNaN(end) && start <= end) {
        const indices = [];
        for (let i = start; i <= end; i++) {
          indices.push(i - 1);
        }
        groups.push({ label: `${start}-${end}`, indices });
      }
    } else {
      const pageNum = parseInt(clean, 10);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= maxPages) {
        groups.push({ label: `${pageNum}`, indices: [pageNum - 1] });
      }
    }
  }

  return groups;
};

class PdfService {

  // 1. Merge PDFs: Combine all documents into one
  async mergePdfs(files) {
    if (!files || files.length < 2) {
      throw new Error('At least two PDF files are required for merging.');
    }

    const mergedPdf = await PDFDocument.create();

    for (const file of files) {
      if (!pdfUtils.isValidPdfBuffer(file.buffer)) {
        throw new Error(`File "${file.originalname}" is corrupted or is not a valid PDF.`);
      }

      try {
        const srcDoc = await PDFDocument.load(file.buffer);
        const copiedPages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      } catch (err) {
        if (err.message.includes('encrypted') || err.message.includes('password')) {
          throw new Error(`File "${file.originalname}" is password-protected. Unlock it first.`);
        }
        throw new Error(`Failed to load PDF "${file.originalname}": ${err.message}`);
      }
    }

    const bytes = await mergedPdf.save();
    return Buffer.from(bytes);
  }

  // 2. Split PDF: Extracts ranges and packages them in a ZIP archive
  async splitPdf(file, rangeString) {
    if (!file || !pdfUtils.isValidPdfBuffer(file.buffer)) {
      throw new Error('Corrupted or invalid PDF file.');
    }

    if (!rangeString) {
      throw new Error('Split page ranges are required (e.g., "1-3, 5").');
    }

    let srcDoc;
    try {
      srcDoc = await PDFDocument.load(file.buffer);
    } catch (err) {
      if (err.message.includes('encrypted') || err.message.includes('password')) {
        throw new Error('This PDF is password-protected. Unlock it first.');
      }
      throw err;
    }

    const totalPages = srcDoc.getPageCount();
    const groups = parseRangeGroups(rangeString, totalPages);

    if (groups.length === 0) {
      throw new Error('Specified page ranges are invalid or out of bounds.');
    }

    // Initialize zip archiver using stream piping
    const archive = archiver('zip', { zlib: { level: 9 } });
    const zipStream = new PassThrough();
    const buffers = [];

    zipStream.on('data', (chunk) => buffers.push(chunk));

    const zipPromise = new Promise((resolve, reject) => {
      zipStream.on('end', () => resolve(Buffer.concat(buffers)));
      zipStream.on('error', (err) => reject(err));
    });

    archive.pipe(zipStream);

    // Process each group and write to ZIP
    for (const group of groups) {
      const subDoc = await PDFDocument.create();
      const copiedPages = await subDoc.copyPages(srcDoc, group.indices);
      copiedPages.forEach((page) => subDoc.addPage(page));

      const subBytes = await subDoc.save();
      const fileName = `split_pages_${group.label}.pdf`;
      archive.append(Buffer.from(subBytes), { name: fileName });
    }

    await archive.finalize();
    return await zipPromise;
  }

  // 3. Compress PDF: Uses Ghostscript for REAL compression (recompresses embedded images).
  //    Falls back to basic pdf-lib stream cleanup if Ghostscript ("gs") is not installed on the server.
  async compressPdf(file, level = 'medium') {
    if (!file || !pdfUtils.isValidPdfBuffer(file.buffer)) {
      throw new Error('Corrupted or invalid PDF file.');
    }

    const { execFile } = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    // Windows uses 'gswin64c', Linux/Mac use 'gs'
    const gsBinary = process.platform === 'win32' ? 'gswin64c' : 'gs';

    // Ghostscript quality presets — this is what actually changes output size
    const presetMap = {
      low: '/screen',   // smallest file, lowest image quality  (~72 dpi)
      medium: '/ebook',  // good balance (~150 dpi)
      high: '/printer'   // largest file, best quality (~300 dpi)
    };
    const preset = presetMap[level] || presetMap.medium;

    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `in_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
    const outputPath = path.join(tmpDir, `out_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
    fs.writeFileSync(inputPath, file.buffer);

    try {
      await new Promise((resolve, reject) => {
        execFile(gsBinary, [
          '-sDEVICE=pdfwrite',
          '-dCompatibilityLevel=1.4',
          `-dPDFSETTINGS=${preset}`,
          '-dNOPAUSE', '-dQUIET', '-dBATCH',
          `-sOutputFile=${outputPath}`,
          inputPath
        ], (err) => (err ? reject(err) : resolve()));
      });

      const result = fs.readFileSync(outputPath);
      return result;
    } catch (err) {
      console.warn('[Ghostscript not available] Falling back to basic pdf-lib compression.', err.message);

      // ---- Fallback: basic pdf-lib stream cleanup (does NOT recompress images) ----
      let srcDoc;
      try {
        srcDoc = await PDFDocument.load(file.buffer);
      } catch (loadErr) {
        if (loadErr.message.includes('encrypted') || loadErr.message.includes('password')) {
          throw new Error('This PDF is password-protected. Unlock it first.');
        }
        throw loadErr;
      }

      const compressedDoc = await PDFDocument.create();
      const copiedPages = await compressedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
      copiedPages.forEach((page) => compressedDoc.addPage(page));

      compressedDoc.setTitle('');
      compressedDoc.setAuthor('');
      compressedDoc.setSubject('');
      compressedDoc.setCreator('');
      compressedDoc.setProducer('');

      const bytes = await compressedDoc.save({ useObjectStreams: true, updateMetadata: false });
      return Buffer.from(bytes);
    } finally {
      fs.unlink(inputPath, () => { });
      fs.unlink(outputPath, () => { });
    }
  }

  // 4. Rotate PDF: Rotates specific pages by custom angles
  async rotatePdf(file, rotationConfigs) {
    if (!file || !pdfUtils.isValidPdfBuffer(file.buffer)) {
      throw new Error('Corrupted or invalid PDF file.');
    }

    let srcDoc;
    try {
      srcDoc = await PDFDocument.load(file.buffer);
    } catch (err) {
      if (err.message.includes('encrypted') || err.message.includes('password')) {
        throw new Error('This PDF is password-protected. Unlock it first.');
      }
      throw err;
    }

    const totalPages = srcDoc.getPageCount();

    // rotationConfigs structure: { "0": 90, "1": 180, ... } mapping 0-indexed page to degrees
    for (const [pageIdxStr, angle] of Object.entries(rotationConfigs)) {
      const pageIdx = parseInt(pageIdxStr, 10);
      if (pageIdx >= 0 && pageIdx < totalPages) {
        const page = srcDoc.getPage(pageIdx);
        const currentRotation = page.getRotation().angle;
        // Normalise rotation degree sum
        const targetRotation = (currentRotation + angle) % 360;
        page.setRotation(degrees(targetRotation));
      }
    }

    const bytes = await srcDoc.save();
    return Buffer.from(bytes);
  }

  // 5. Delete Pages: Deletes a list of specified pages
  async deletePages(file, pagesArray) {
    if (!file || !pdfUtils.isValidPdfBuffer(file.buffer)) {
      throw new Error('Corrupted or invalid PDF file.');
    }

    let srcDoc;
    try {
      srcDoc = await PDFDocument.load(file.buffer);
    } catch (err) {
      if (err.message.includes('encrypted') || err.message.includes('password')) {
        throw new Error('This PDF is password-protected. Unlock it first.');
      }
      throw err;
    }

    const totalPages = srcDoc.getPageCount();

    // Validate indices and convert 1-index pages to 0-index sorted in descending order
    // Descending order is crucial to prevent shifting indices during multiple deletion loops!
    const targetIndices = pagesArray
      .map(p => parseInt(p, 10) - 1)
      .filter(idx => idx >= 0 && idx < totalPages)
      .sort((a, b) => b - a);

    if (targetIndices.length === 0) {
      throw new Error('No valid pages specified for deletion.');
    }

    if (targetIndices.length >= totalPages) {
      throw new Error('Cannot delete all pages of a PDF document.');
    }

    for (const idx of targetIndices) {
      srcDoc.removePage(idx);
    }

    const bytes = await srcDoc.save();
    return Buffer.from(bytes);
  }

  // 6. Extract Pages: Compiles a new PDF with only selected pages
  async extractPages(file, pagesArray) {
    if (!file || !pdfUtils.isValidPdfBuffer(file.buffer)) {
      throw new Error('Corrupted or invalid PDF file.');
    }

    let srcDoc;
    try {
      srcDoc = await PDFDocument.load(file.buffer);
    } catch (err) {
      if (err.message.includes('encrypted') || err.message.includes('password')) {
        throw new Error('This PDF is password-protected. Unlock it first.');
      }
      throw err;
    }

    const totalPages = srcDoc.getPageCount();

    // Resolve 0-indexed page list in requested order
    const targetIndices = pagesArray
      .map(p => parseInt(p, 10) - 1)
      .filter(idx => idx >= 0 && idx < totalPages);

    if (targetIndices.length === 0) {
      throw new Error('No valid pages specified for extraction.');
    }

    const extractedDoc = await PDFDocument.create();
    const copiedPages = await extractedDoc.copyPages(srcDoc, targetIndices);
    copiedPages.forEach((page) => extractedDoc.addPage(page));

    const bytes = await extractedDoc.save();
    return Buffer.from(bytes);
  }
}

module.exports = new PdfService();