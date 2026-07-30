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

// Mock auth middleware to bypass JWT validations and supply test user
jest.mock('../src/middleware/auth', () => {
  return jest.fn().mockImplementation((req, res, next) => {
    req.user = { id: 1, email: 'test@toolnest.com', role: 'free' };
    next();
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
        return Promise.resolve([[{ id: 7 }]]);
      }
      return Promise.resolve([[]]);
    })
  };
});

const app = require('../src/app');
const imageService = require('../src/services/imageService');

describe('AI Background Removal Unit & Integration Tests', () => {
  let dummyBaseBuffer;

  beforeAll(async () => {
    // Generate a 10x10 PNG buffer with solid red colors on corners and white inside
    // (Corners act as background color; center acts as subject)
    const rawPixels = Buffer.alloc(10 * 10 * 4);
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const idx = (y * 10 + x) * 4;
        const isCornerOrBorder = x === 0 || x === 9 || y === 0 || y === 9;
        if (isCornerOrBorder) {
          rawPixels[idx] = 255;   // Red
          rawPixels[idx + 1] = 0; // Green
          rawPixels[idx + 2] = 0; // Blue
          rawPixels[idx + 3] = 255;
        } else {
          rawPixels[idx] = 255;   // White
          rawPixels[idx + 1] = 255;
          rawPixels[idx + 2] = 255;
          rawPixels[idx + 3] = 255;
        }
      }
    }
    dummyBaseBuffer = await sharp(rawPixels, { raw: { width: 10, height: 10, channels: 4 } }).png().toBuffer();
  });

  describe('Unit Tests - imageService.removeBackground', () => {
    test('should execute local worker connected flood-fill background removal and cache it', async () => {
      const file = {
        buffer: dummyBaseBuffer,
        mimetype: 'image/png'
      };

      const options = {
        edgeSmoothing: 'false',
        autoCrop: 'false'
      };

      // 1. Initial execution (Cache Miss)
      const initialBuffer = await imageService.removeBackground(file, options);
      expect(Buffer.isBuffer(initialBuffer)).toBe(true);

      const metadata = await sharp(initialBuffer).metadata();
      expect(metadata.format).toBe('png');
      expect(metadata.hasAlpha).toBe(true);

      // Verify corner pixel is transparent
      const { data: rawOut } = await sharp(initialBuffer).raw().toBuffer({ resolveWithObject: true });
      expect(rawOut[3]).toBe(0); // Corner alpha should be 0 (transparent)

      // 2. Repeat execution (Cache Hit)
      const spyHash = jest.spyOn(imageService, '_getCacheKey');
      const cachedBuffer = await imageService.removeBackground(file, options);
      expect(spyHash).toHaveBeenCalled();
      expect(cachedBuffer).toEqual(initialBuffer);
      spyHash.mockRestore();
    });

    test('should apply edge feathering smoothing filter', async () => {
      const file = {
        buffer: dummyBaseBuffer,
        mimetype: 'image/png'
      };

      const options = {
        edgeSmoothing: 'true',
        autoCrop: 'false'
      };

      const smoothBuffer = await imageService.removeBackground(file, options);
      expect(Buffer.isBuffer(smoothBuffer)).toBe(true);
    });
  });

  describe('Integration Tests - API Route Endpoints', () => {
    test('POST /api/v1/image/remove-background should remove background of a single image', async () => {
      const response = await request(app)
        .post('/api/v1/image/remove-background')
        .field('edgeSmoothing', 'true')
        .field('autoCrop', 'true')
        .attach('file', dummyBaseBuffer, 'base.png');

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/png');
    });

    test('POST /api/v1/image/remove-background should fail validation for invalid parameters', async () => {
      const response = await request(app)
        .post('/api/v1/image/remove-background')
        .field('edgeSmoothing', 'not-a-boolean')
        .attach('file', dummyBaseBuffer, 'base.png');

      expect(response.statusCode).toBe(400);
      expect(response.body.status).toBe('error');
      expect(response.body.message).toContain('edgeSmoothing must be a boolean');
    });

    test('POST /api/v1/image/remove-background-batch should batch process images and return ZIP', async () => {
      const response = await request(app)
        .post('/api/v1/image/remove-background-batch')
        .field('edgeSmoothing', 'false')
        .attach('files', dummyBaseBuffer, 'img1.png')
        .attach('files', dummyBaseBuffer, 'img2.png');

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/zip');
    });
  });
});
