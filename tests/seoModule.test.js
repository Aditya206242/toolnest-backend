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

// Mock auth middleware to bypass JWT validation and supply admin user
jest.mock('../src/middleware/auth', () => {
  return jest.fn().mockImplementation((req, res, next) => {
    req.user = { id: 1, email: 'admin@toolnest.com', role: 'admin' };
    next();
  });
});

// Mock role check middleware to permit admin access to Blog CMS
jest.mock('../src/middleware/role', () => {
  return () => jest.fn().mockImplementation((req, res, next) => {
    next();
  });
});

const request = require('supertest');
const app = require('../src/app');

// Dynamic DB mocks
const mockQuery = jest.fn();
const mockGetConnection = jest.fn();
const mockConnection = {
  beginTransaction: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn(),
  query: mockQuery,
  release: jest.fn()
};

jest.mock('../src/config/db', () => {
  return {
    query: (...args) => mockQuery(...args),
    getConnection: () => mockGetConnection()
  };
});

describe('SEO & Crawlers Integration Tests Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnection.mockResolvedValue(mockConnection);
  });

  describe('Global Redirection Engine', () => {
    test('should redirect matched source_path to target_path with 301/302 status code', async () => {
      // Mock db.query return value for redirect middleware lookup
      mockQuery.mockResolvedValueOnce([[{ target_path: '/image/compress', status_code: 301 }]]);

      const response = await request(app)
        .get('/old-compress-url')
        .send();

      expect(response.statusCode).toBe(301);
      expect(response.headers.location).toBe('/image/compress');
    });

    test('should proceed normally if source_path does not exist in redirect map', async () => {
      mockQuery.mockResolvedValueOnce([[]]); // No redirect mapping found

      const response = await request(app)
        .get('/api/v1/health') // Route exists in app.js
        .send();

      // Healthy response status checks
      expect(response.statusCode).toBe(200);
      expect(response.headers.location).toBeUndefined();
    });
  });

  describe('Duplicate Content validation check', () => {
    test('POST /api/v1/blog/admin/blogs should fail with 409 conflict when canonical URL is claimed', async () => {
      const payload = {
        title: 'New Post Title',
        content: '<p>Body text</p>',
        canonicalUrl: 'https://toolnest.com/claimed-canonical'
      };

      // Mock DB: slug check passes, but duplicate canonical check fails
      mockQuery.mockResolvedValueOnce([[]]); // SELECT id FROM blogs WHERE slug = ?
      mockQuery.mockResolvedValueOnce([[{ id: 98, title: 'Existing Claimed Post' }]]); // SELECT id FROM blogs WHERE canonical_url = ?

      const response = await request(app)
        .post('/api/v1/blog/admin/blogs')
        .send(payload);

      expect(response.statusCode).toBe(409);
      expect(response.body.status).toBe('error');
      expect(response.body.message).toContain('Duplicate content warning');
    });
  });

  describe('Sitemap Cache & Namespace parameters', () => {
    test('GET /sitemap.xml should render image namespace schemas and return xml headers', async () => {
      // Mock db queries: active tools list and blogs list
      mockQuery.mockResolvedValueOnce([[{ name: 'Resize Image', slug: 'image-resize', category: 'image' }]]); // SELECT tools
      mockQuery.mockResolvedValueOnce([[{ slug: 'blog-post-1', featured_image: '/uploads/featured.webp', lastmod: '2026-07-28' }]]); // SELECT blogs
      mockQuery.mockResolvedValueOnce([[{ slug: 'tech' }]]); // SELECT categories
      mockQuery.mockResolvedValueOnce([[{ slug: 'node' }]]); // SELECT tags

      const response = await request(app)
        .get('/sitemap.xml')
        .send();

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/xml');
      
      // XML String match checks
      expect(response.text).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
      expect(response.text).toContain('<image:image>');
      expect(response.text).toContain('/uploads/featured.webp');
    });
  });

  describe('Robots.txt Constraints', () => {
    test('GET /robots.txt should include search exclusions and crawl delays settings', async () => {
      const response = await request(app)
        .get('/robots.txt')
        .send();

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.text).toContain('Disallow: /*?*search=');
      expect(response.text).toContain('Crawl-delay: 1');
    });
  });
});
