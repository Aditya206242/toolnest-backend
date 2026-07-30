// Mock ESM archiver module to prevent CommonJS parsing syntax errors in Jest
jest.mock('archiver', () => {
  return jest.fn();
});

// Mock database client to isolate health checks and sitemaps execution without live connection dependencies
jest.mock('../src/config/db', () => {
  return {
    query: jest.fn().mockImplementation((queryStr) => {
      if (queryStr.trim() === 'SELECT 1') {
        return Promise.resolve([[ { 1: 1 } ]]);
      }
      return Promise.resolve([[]]);
    })
  };
});

const request = require('supertest');
const app = require('../src/app');

describe('API Server Production Hardening Integration Tests', () => {
  
  // 1. Health check verification
  test('GET /api/v1/health should respond with healthy status details', async () => {
    const response = await request(app).get('/api/v1/health');
    
    // Uptime and check parameters must exist
    expect(response.statusCode).toBe(200);
    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('serverTimestamp');
    expect(response.body).toHaveProperty('uptime');
    expect(response.body).toHaveProperty('checks');
    expect(response.body.checks).toHaveProperty('database');
    expect(response.body.checks).toHaveProperty('redis');
  });

  // 2. SEO Sitemap XML verification
  test('GET /sitemap.xml should respond with valid XML headers', async () => {
    const response = await request(app).get('/sitemap.xml');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/xml');
  });

  // 3. SEO Robots.txt verification
  test('GET /robots.txt should respond with text directives', async () => {
    const response = await request(app).get('/robots.txt');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('User-agent: *');
    expect(response.text).toContain('Disallow: /admin/');
  });

  // 4. Wildcard handler check
  test('GET /invalid-route should trigger 404 handler', async () => {
    const response = await request(app).get('/invalid-route-slug-check');
    expect(response.statusCode).toBe(404);
    expect(response.body).toHaveProperty('status', 'error');
  });
});
