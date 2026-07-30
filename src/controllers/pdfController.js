const pdfService = require('../services/pdfService');
const db = require('../config/db');

// Helper to log tool execution metrics for rate-limit quota tracking and admin analytics
const logToolExecution = async (req, toolSlug) => {
  try {
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
    const today = new Date().toISOString().split('T')[0];
    const userId = req.user ? req.user.id : null;

    const [tools] = await db.query('SELECT id FROM tools WHERE slug = ?', [toolSlug]);
    if (tools.length === 0) {
      console.warn(`[Analytics Warning] Tool slug '${toolSlug}' not found in database.`);
      return;
    }
    const toolId = tools[0].id;

    // 1. Audit trail session log
    await db.query(
      'INSERT INTO activity_logs (user_id, action, ip_address, details) VALUES (?, ?, ?, ?)',
      [userId, 'tool_execution', ipAddress, `Executed tool: ${toolSlug}`]
    );

    // 2. Incremental count update
    await db.query(
      `INSERT INTO tool_usage (user_id, tool_id, request_count, source, usage_date) 
       VALUES (?, ?, 1, 'web', ?) 
       ON DUPLICATE KEY UPDATE request_count = request_count + 1`,
      [userId, toolId, today]
    );
  } catch (error) {
    console.error('[Analytics Log Fail]', error.message);
  }
};

// 1. Merge PDF
exports.merge = async (req, res, next) => {
  try {
    if (!req.files || req.files.length < 2) {
      return res.status(400).json({
        status: 'error',
        message: 'At least two PDF files are required for merging.',
      });
    }

    const mergedBuffer = await pdfService.mergePdfs(req.files);
    
    await logToolExecution(req, 'pdf-merge');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="merged.pdf"');
    res.send(mergedBuffer);
  } catch (error) {
    next(error);
  }
};

// 2. Split PDF
exports.split = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No PDF file was uploaded.',
      });
    }

    const { range } = req.body;
    if (!range) {
      return res.status(400).json({
        status: 'error',
        message: 'Range values are required for splitting (e.g. 1-3, 5).',
      });
    }

    const zipBuffer = await pdfService.splitPdf(req.file, range);

    await logToolExecution(req, 'pdf-split');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="split.zip"');
    res.send(zipBuffer);
  } catch (error) {
    next(error);
  }
};

// 3. Compress PDF
exports.compress = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No PDF file was uploaded.',
      });
    }

    const { level } = req.body; // 'low', 'medium', 'high'
    const compressedBuffer = await pdfService.compressPdf(req.file, level);

    await logToolExecution(req, 'pdf-compress');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="compressed.pdf"');
    res.send(compressedBuffer);
  } catch (error) {
    next(error);
  }
};

// 4. Rotate PDF
exports.rotate = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No PDF file was uploaded.',
      });
    }

    const { rotationConfigs } = req.body;
    if (!rotationConfigs) {
      return res.status(400).json({
        status: 'error',
        message: 'Rotation config details are required.',
      });
    }

    // Parse JSON configurations if sent as string from boundary forms
    let parsedConfigs = rotationConfigs;
    if (typeof rotationConfigs === 'string') {
      try {
        parsedConfigs = JSON.parse(rotationConfigs);
      } catch (err) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid JSON format for rotationConfigs.',
        });
      }
    }

    const rotatedBuffer = await pdfService.rotatePdf(req.file, parsedConfigs);

    await logToolExecution(req, 'pdf-rotate');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="rotated.pdf"');
    res.send(rotatedBuffer);
  } catch (error) {
    next(error);
  }
};

// 5. Delete Pages
exports.deletePages = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No PDF file was uploaded.',
      });
    }

    const { pages } = req.body; // comma-separated string or array
    if (!pages) {
      return res.status(400).json({
        status: 'error',
        message: 'Page numbers for deletion are required.',
      });
    }

    let parsedPages = pages;
    if (typeof pages === 'string') {
      parsedPages = pages.split(',').map(p => p.trim());
    }

    const finalBuffer = await pdfService.deletePages(req.file, parsedPages);

    await logToolExecution(req, 'pdf-delete-pages');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="deleted_pages.pdf"');
    res.send(finalBuffer);
  } catch (error) {
    next(error);
  }
};

// 6. Extract Pages
exports.extractPages = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No PDF file was uploaded.',
      });
    }

    const { pages } = req.body; // comma-separated string or array
    if (!pages) {
      return res.status(400).json({
        status: 'error',
        message: 'Page numbers for extraction are required.',
      });
    }

    let parsedPages = pages;
    if (typeof pages === 'string') {
      parsedPages = pages.split(',').map(p => p.trim());
    }

    const finalBuffer = await pdfService.extractPages(req.file, parsedPages);

    await logToolExecution(req, 'pdf-extract-pages');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="extracted_pages.pdf"');
    res.send(finalBuffer);
  } catch (error) {
    next(error);
  }
};
