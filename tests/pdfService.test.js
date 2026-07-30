// Mock ESM archiver module to prevent CommonJS parsing issues in Jest
jest.mock('archiver', () => {
  return jest.fn().mockImplementation(() => {
    const { PassThrough } = require('stream');
    const mockArchive = new PassThrough();
    mockArchive.append = jest.fn();
    mockArchive.finalize = jest.fn().mockImplementation(async () => {
      mockArchive.write(Buffer.from('mock zip output contents'));
      mockArchive.end();
    });
    return mockArchive;
  });
});

const { PDFDocument } = require('pdf-lib');
const pdfService = require('../src/services/pdfService');

// Helper to create valid in-memory PDF buffers for testing
const createTestPdfBuffer = async (pageCount = 1) => {
  const pdfDoc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    pdfDoc.addPage([300, 400]);
  }
  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
};

describe('PDF Service Actions Audit Tests', () => {
  let onePageBuffer;
  let threePageBuffer;

  beforeAll(async () => {
    onePageBuffer = await createTestPdfBuffer(1);
    threePageBuffer = await createTestPdfBuffer(3);
  });

  describe('mergePdfs', () => {
    test('should merge multiple PDF buffers successfully', async () => {
      const files = [
        { originalname: 'doc1.pdf', buffer: onePageBuffer },
        { originalname: 'doc2.pdf', buffer: threePageBuffer }
      ];

      const result = await pdfService.mergePdfs(files);
      expect(result).toBeInstanceOf(Buffer);

      // Verify page count of merged document
      const mergedDoc = await PDFDocument.load(result);
      expect(mergedDoc.getPageCount()).toBe(4);
    });

    test('should throw error if less than two files are provided', async () => {
      const files = [{ originalname: 'doc1.pdf', buffer: onePageBuffer }];
      await expect(pdfService.mergePdfs(files)).rejects.toThrow('At least two PDF files are required');
    });
  });

  describe('splitPdf', () => {
    test('should split PDF document by page ranges into ZIP archive', async () => {
      const file = { originalname: 'doc3.pdf', buffer: threePageBuffer };
      
      const zipStream = await pdfService.splitPdf(file, '1-2, 3');
      expect(zipStream).toBeDefined();
    });
  });

  describe('compressPdf', () => {
    test('should compress a PDF document buffer successfully', async () => {
      const file = { originalname: 'doc.pdf', buffer: threePageBuffer };
      
      const result = await pdfService.compressPdf(file, 'medium');
      expect(result).toBeInstanceOf(Buffer);

      const compressedDoc = await PDFDocument.load(result);
      expect(compressedDoc.getPageCount()).toBe(3);
    });
  });

  describe('rotatePdf', () => {
    test('should rotate designated pages inside PDF', async () => {
      const file = { originalname: 'doc.pdf', buffer: threePageBuffer };
      
      // Rotate page 1 by 90 and page 3 by 270 degrees
      const result = await pdfService.rotatePdf(file, { "0": 90, "2": 270 });
      expect(result).toBeInstanceOf(Buffer);

      const rotatedDoc = await PDFDocument.load(result);
      
      expect(rotatedDoc.getPage(0).getRotation().angle).toBe(90);
      expect(rotatedDoc.getPage(1).getRotation().angle).toBe(0);
      expect(rotatedDoc.getPage(2).getRotation().angle).toBe(270);
    });
  });

  describe('deletePages', () => {
    test('should delete targeted pages from PDF document', async () => {
      const file = { originalname: 'doc.pdf', buffer: threePageBuffer };
      
      // Delete page 2 (leaving pages 1 and 3)
      const result = await pdfService.deletePages(file, ['2']);
      expect(result).toBeInstanceOf(Buffer);

      const resultDoc = await PDFDocument.load(result);
      expect(resultDoc.getPageCount()).toBe(2);
    });
  });

  describe('extractPages', () => {
    test('should extract only specific page selections from PDF', async () => {
      const file = { originalname: 'doc.pdf', buffer: threePageBuffer };
      
      // Extract pages 1 and 3
      const result = await pdfService.extractPages(file, ['1', '3']);
      expect(result).toBeInstanceOf(Buffer);

      const resultDoc = await PDFDocument.load(result);
      expect(resultDoc.getPageCount()).toBe(2);
    });
  });
});
