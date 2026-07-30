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
      // Return tool ID mock if checking toolslug
      if (queryStr.includes('SELECT id FROM tools WHERE slug = ?')) {
        return Promise.resolve([[{ id: 5 }]]);
      }
      return Promise.resolve([[]]);
    })
  };
});

const app = require('../src/app');
const imageService = require('../src/services/imageService');

describe('Image Rotate Unit & Integration Tests', () => {
  let dummyBuffer;

  beforeAll(async () => {
    // Generate a 10x10 dummy PNG buffer with transparency for tests
    dummyBuffer = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 }
      }
    }).png().toBuffer();
  });

  describe('Unit Tests - imageService.rotate', () => {
    test('should rotate image buffer successfully by 90 degrees', async () => {
      const file = {
        buffer: dummyBuffer,
        mimetype: 'image/png'
      };
      
      const { buffer, format } = await imageService.rotate(file, { degrees: 90 });
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(format).toBe('png');

      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(10);
      expect(metadata.height).toBe(10);
    });

    test('should automatically convert JPEGs to PNG if keepTransparency is true', async () => {
      const jpegBuffer = await sharp({
        create: {
          width: 10,
          height: 10,
          channels: 3,
          background: { r: 255, g: 0, b: 0 }
        }
      }).jpeg().toBuffer();

      const file = {
        buffer: jpegBuffer,
        mimetype: 'image/jpeg'
      };

      const { buffer, format } = await imageService.rotate(file, {
        degrees: 45,
        keepTransparency: true
      });

      expect(format).toBe('png');
      const metadata = await sharp(buffer).metadata();
      expect(metadata.hasAlpha).toBe(true);
    });
  });

  describe('Integration Tests - API Route Endpoints', () => {
    test('POST /api/v1/image/rotate should rotate a single image', async () => {
      const response = await request(app)
        .post('/api/v1/image/rotate')
        .field('degrees', '90')
        .field('quality', '80')
        .attach('file', dummyBuffer, 'dummy.png');

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/png');
      expect(response.body).toBeDefined();
    });

    test('POST /api/v1/image/rotate should return 400 for invalid parameters', async () => {
      const response = await request(app)
        .post('/api/v1/image/rotate')
        .field('degrees', '450') // Invalid degree limit
        .attach('file', dummyBuffer, 'dummy.png');

      expect(response.statusCode).toBe(400);
      expect(response.body.status).toBe('error');
      expect(response.body.message).toContain('Degrees must be a number');
    });

    test('POST /api/v1/image/rotate-batch should rotate a batch of images and return ZIP', async () => {
      const response = await request(app)
        .post('/api/v1/image/rotate-batch')
        .field('degrees', '180')
        .attach('files', dummyBuffer, 'dummy1.png')
        .attach('files', dummyBuffer, 'dummy2.png');

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/zip');
    });
  });
});
