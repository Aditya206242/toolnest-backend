// Mock ESM archiver module to prevent CommonJS parsing syntax errors in Jest
jest.mock('archiver', () => {
  return jest.fn().mockImplementation(() => {
    const { PassThrough } = require('stream');
    const mockArchive = new PassThrough();
    mockArchive.append = jest.fn();
    mockArchive.finalize = jest.fn().mockImplementation(async () => {
      mockArchive.write(Buffer.from('mock zip content'));
      mockArchive.end();
    });
    return mockArchive;
  });
});

const request = require('supertest');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Mock database connection client to prevent live DB queries
jest.mock('../src/config/db', () => {
  return {
    query: jest.fn().mockImplementation((queryStr, params) => {
      if (queryStr.includes('SELECT id FROM tools WHERE slug = ?')) {
        return Promise.resolve([[{ id: 6 }]]);
      }
      return Promise.resolve([[]]);
    })
  };
});

const app = require('../src/app');
const imageService = require('../src/services/imageService');

describe('Image Watermark Unit & Integration Tests', () => {
  let dummyBaseBuffer;
  let dummyLogoBuffer;
  let dummySvgBuffer;
  let dummyFontBuffer;

  beforeAll(async () => {
    // Generate a 100x100 base PNG buffer
    dummyBaseBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 }
      }
    }).png().toBuffer();

    // Generate a 20x20 logo watermark PNG buffer
    dummyLogoBuffer = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0.8 }
      }
    }).png().toBuffer();

    // Create standard SVG string buffer
    dummySvgBuffer = Buffer.from(`
      <svg width="40" height="20" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="blue"/>
        <text x="5" y="15" fill="white" font-size="12">SVG</text>
      </svg>
    `);

    // Create a dummy TTF font binary stream
    dummyFontBuffer = Buffer.from('dummy-font-ttf-binary-data');
  });

  describe('Unit Tests - imageService.watermark', () => {
    test('should apply text watermark successfully with default options', async () => {
      const baseFile = {
        buffer: dummyBaseBuffer,
        mimetype: 'image/png'
      };

      const options = {
        watermarkType: 'text',
        text: 'Test Unit',
        font: 'Arial',
        fontSize: '24',
        color: '#ffffff',
        opacity: '0.8',
        scale: '0.5',
        rotation: '0',
        positionType: 'center'
      };

      const resultBuffer = await imageService.watermark(baseFile, null, options, null);
      expect(Buffer.isBuffer(resultBuffer)).toBe(true);

      const metadata = await sharp(resultBuffer).metadata();
      expect(metadata.width).toBe(100);
      expect(metadata.height).toBe(100);
    });

    test('should apply text watermark with outline, shadow, and background plate', async () => {
      const baseFile = {
        buffer: dummyBaseBuffer,
        mimetype: 'image/png'
      };

      const options = {
        watermarkType: 'text',
        text: 'Luxury Plate',
        font: 'Pacifico',
        fontSize: '24',
        color: '#ffffff',
        outlineColor: '#ff0000',
        outlineWidth: '3',
        shadowEnabled: 'true',
        shadowX: '4',
        shadowY: '4',
        shadowBlur: '2',
        shadowColor: '#000000',
        padding: '10',
        bgOpacity: '0.5',
        bgColor: '#00ff00',
        opacity: '0.9',
        scale: '0.4',
        rotation: '45',
        positionType: 'top-left'
      };

      const resultBuffer = await imageService.watermark(baseFile, null, options, null);
      expect(Buffer.isBuffer(resultBuffer)).toBe(true);
    });

    test('should apply image logo watermark successfully', async () => {
      const baseFile = {
        buffer: dummyBaseBuffer,
        mimetype: 'image/png'
      };

      const watermarkFile = {
        buffer: dummyLogoBuffer,
        mimetype: 'image/png',
        originalname: 'logo.png'
      };

      const options = {
        watermarkType: 'image',
        opacity: '0.7',
        scale: '0.2',
        rotation: '90',
        positionType: 'bottom-right'
      };

      const resultBuffer = await imageService.watermark(baseFile, watermarkFile, options, null);
      expect(Buffer.isBuffer(resultBuffer)).toBe(true);
    });

    test('should apply SVG watermark successfully', async () => {
      const baseFile = {
        buffer: dummyBaseBuffer,
        mimetype: 'image/png'
      };

      const watermarkFile = {
        buffer: dummySvgBuffer,
        mimetype: 'image/svg+xml',
        originalname: 'watermark.svg'
      };

      const options = {
        watermarkType: 'svg',
        opacity: '0.8',
        scale: '0.3',
        rotation: '-15',
        positionType: 'center'
      };

      const resultBuffer = await imageService.watermark(baseFile, watermarkFile, options, null);
      expect(Buffer.isBuffer(resultBuffer)).toBe(true);
    });
  });

  describe('Integration Tests - API Route Endpoints', () => {
    test('POST /api/v1/image/watermark should apply a single text watermark', async () => {
      const response = await request(app)
        .post('/api/v1/image/watermark')
        .field('watermarkType', 'text')
        .field('text', 'WatermarkTest')
        .field('font', 'Arial')
        .field('fontSize', '32')
        .field('color', '#ff00ff')
        .field('opacity', '0.6')
        .field('scale', '0.4')
        .field('rotation', '0')
        .field('positionType', 'center')
        .attach('image', dummyBaseBuffer, 'base.png');

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/png');
    });

    test('POST /api/v1/image/watermark should handle image logo and custom font files', async () => {
      const response = await request(app)
        .post('/api/v1/image/watermark')
        .field('watermarkType', 'image')
        .field('opacity', '0.5')
        .field('scale', '0.3')
        .field('rotation', '180')
        .field('positionType', 'bottom-left')
        .attach('image', dummyBaseBuffer, 'base.png')
        .attach('watermark', dummyLogoBuffer, 'logo.png');

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/png');
    });

    test('POST /api/v1/image/watermark should fail parameter checks', async () => {
      const response = await request(app)
        .post('/api/v1/image/watermark')
        .field('watermarkType', 'text')
        .field('opacity', '1.5') // Out of bounds [0, 1]
        .attach('image', dummyBaseBuffer, 'base.png');

      expect(response.statusCode).toBe(400);
      expect(response.body.status).toBe('error');
      expect(response.body.message).toContain('Opacity must be a float between 0 and 1');
    });

    test('POST /api/v1/image/watermark-batch should batch process and return ZIP', async () => {
      const response = await request(app)
        .post('/api/v1/image/watermark-batch')
        .field('watermarkType', 'text')
        .field('text', 'BatchWatermark')
        .field('fontSize', '20')
        .field('opacity', '0.8')
        .attach('images', dummyBaseBuffer, 'img1.png')
        .attach('images', dummyBaseBuffer, 'img2.png');

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/zip');
    });
  });
});
