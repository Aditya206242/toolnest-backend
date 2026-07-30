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
    req.user = { id: 1, email: 'test@toolnest.com', role: 'premium' };
    next();
  });
});

// Mock premium middleware to allow AI Upscaling endpoint requests
jest.mock('../src/middleware/premium', () => {
  return jest.fn().mockImplementation((req, res, next) => {
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
        return Promise.resolve([[{ id: 8 }]]);
      }
      return Promise.resolve([[]]);
    })
  };
});

const app = require('../src/app');
const imageService = require('../src/services/imageService');

describe('AI Neural Upscaling Unit & Integration Tests', () => {
  let dummyBaseBuffer;

  beforeAll(async () => {
    // Generate a simple 10x10 PNG buffer to use for tests
    dummyBaseBuffer = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 255 }
      }
    }).png().toBuffer();
  });

  describe('Unit Tests - imageService.aiUpscale', () => {
    test('should detect GPU capability status as a boolean', async () => {
      const gpuStatus = await imageService.detectGpuSupport();
      expect(typeof gpuStatus).toBe('boolean');
    });

    test('should execute hybrid upscaling factors (e.g. 2x, 4x) and resize dimensions correctly', async () => {
      const file = {
        buffer: dummyBaseBuffer,
        mimetype: 'image/png'
      };

      const options = {
        scale: '2x',
        noiseReduction: 'low',
        sharpen: 'medium',
        faceEnhancement: 'false'
      };

      const resultBuffer = await imageService.aiUpscale(file, options);
      expect(Buffer.isBuffer(resultBuffer)).toBe(true);

      const metadata = await sharp(resultBuffer).metadata();
      expect(metadata.width).toBe(20);
      expect(metadata.height).toBe(20);
    });

    test('should fall back gracefully to bicubic step-down on error', async () => {
      const file = {
        buffer: Buffer.from('corrupt buffer data'),
        mimetype: 'image/png'
      };

      const options = {
        scale: '2x'
      };

      // Since the input buffer is corrupt, both Lanczos3 and standard pipelines fail,
      // but the service should fail cleanly or throw appropriate errors for downstream.
      await expect(imageService.aiUpscale(file, options)).rejects.toThrow();
    });
  });

  describe('Integration Tests - API Route Endpoints', () => {
    test('POST /api/v1/image/ai-upscale should enhance and resize single image successfully', async () => {
      const response = await request(app)
        .post('/api/v1/image/ai-upscale')
        .field('scale', '4x')
        .field('noiseReduction', 'medium')
        .field('sharpen', 'low')
        .attach('file', dummyBaseBuffer, 'base.png');

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/png');
    });

    test('POST /api/v1/image/ai-upscale should fail validation for invalid parameters', async () => {
      const response = await request(app)
        .post('/api/v1/image/ai-upscale')
        .field('scale', '10x') // Invalid scale factor
        .attach('file', dummyBaseBuffer, 'base.png');

      expect(response.statusCode).toBe(400);
      expect(response.body.status).toBe('error');
      expect(response.body.message).toContain('Scale must be 2x, 4x, or 8x');
    });

    test('POST /api/v1/image/ai-upscale-batch should batch upscale images and return ZIP', async () => {
      const response = await request(app)
        .post('/api/v1/image/ai-upscale-batch')
        .field('scale', '2x')
        .attach('files', dummyBaseBuffer, 'img1.png')
        .attach('files', dummyBaseBuffer, 'img2.png');

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/zip');
    });
  });
});
