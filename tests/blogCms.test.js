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

// Dynamic DB mocks to verify query payloads
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

describe('Blog CMS Security & Version Control Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnection.mockResolvedValue(mockConnection);
  });

  describe('XSS HTML Input Sanitization', () => {
    test('POST /api/v1/blog/admin/blogs should filter script injection from content body', async () => {
      const maliciousPayload = {
        title: 'Safe Title',
        content: '<p>Standard text</p><script>alert("XSS")</script><iframe src="javascript:alert(1)"></iframe>',
        summary: 'Snippet summary',
        status: 'draft'
      };

      // Mock database insertion return
      mockQuery.mockResolvedValueOnce([[]]); // SELECT id FROM blogs WHERE slug = ?
      mockQuery.mockResolvedValueOnce([{ insertId: 99 }]); // INSERT INTO blogs

      const response = await request(app)
        .post('/api/v1/blog/admin/blogs')
        .send(maliciousPayload);

      expect(response.statusCode).toBe(201);
      
      // Extract the insert DDL statement arguments sent to db.query
      const insertCall = mockQuery.mock.calls.find(call => 
        typeof call[0] === 'string' && call[0].includes('INSERT INTO blogs')
      );
      
      expect(insertCall).toBeDefined();
      const contentArg = insertCall[1][3]; // content parameter mapping
      
      // Content must have stripped the script and iframe payloads
      expect(contentArg).not.toContain('<script>');
      expect(contentArg).not.toContain('<iframe>');
      expect(contentArg).toContain('<p>Standard text</p>');
    });
  });

  describe('Scheduled Publishing state transition', () => {
    test('POST /api/v1/blog/admin/blogs should set status as scheduled if published_at is set in the future', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);

      const payload = {
        title: 'Future Scheduled Post',
        content: '<p>Future contents</p>',
        status: 'published',
        publishedAt: futureDate.toISOString()
      };

      mockQuery.mockResolvedValueOnce([[]]); // slug uniqueness check
      mockQuery.mockResolvedValueOnce([{ insertId: 101 }]); // INSERT INTO blogs

      const response = await request(app)
        .post('/api/v1/blog/admin/blogs')
        .send(payload);

      expect(response.statusCode).toBe(201);

      const insertCall = mockQuery.mock.calls.find(call => 
        typeof call[0] === 'string' && call[0].includes('INSERT INTO blogs')
      );
      
      expect(insertCall).toBeDefined();
      const statusArg = insertCall[1][16]; // status parameter mapping
      expect(statusArg).toBe('scheduled');
    });
  });

  describe('Revision History snapshots & Reverts', () => {
    test('PUT /api/v1/blog/admin/blogs/:id should archive previous content state before update', async () => {
      // Mock existing post select
      mockQuery.mockResolvedValueOnce([[{ title: 'V1 Title', content: 'V1 Content', summary: 'V1 Excerpt' }]]); // SELECT blogs WHERE id = ?
      mockQuery.mockResolvedValueOnce([[]]); // INSERT INTO blog_revisions
      mockQuery.mockResolvedValueOnce([[]]); // slug check
      mockQuery.mockResolvedValueOnce([[]]); // UPDATE blogs
      mockQuery.mockResolvedValueOnce([[]]); // DELETE categories
      mockQuery.mockResolvedValueOnce([[]]); // DELETE tags

      const updatePayload = {
        title: 'V2 Title',
        content: '<p>V2 content body</p>',
        status: 'draft'
      };

      const response = await request(app)
        .put('/api/v1/blog/admin/blogs/12')
        .send(updatePayload);

      expect(response.statusCode).toBe(200);

      // Verify revision snapshot insertion triggered
      const revisionCall = mockQuery.mock.calls.find(call => 
        typeof call[0] === 'string' && call[0].includes('INSERT INTO blog_revisions')
      );

      expect(revisionCall).toBeDefined();
      expect(revisionCall[1][0]).toBe('12'); // blog_id
      expect(revisionCall[1][1]).toBe('V1 Title');
      expect(revisionCall[1][2]).toBe('V1 Content');
    });

    test('POST /api/v1/blog/admin/blogs/:id/rollback/:revisionId should revert blog content state', async () => {
      // Mock checks
      mockQuery.mockResolvedValueOnce([[{ id: 12, title: 'Current Title', content: 'Current Content', summary: 'Current Excerpt' }]]); // SELECT blogs WHERE id = ?
      mockQuery.mockResolvedValueOnce([[{ id: 9, blog_id: 12, title: 'Revert Title', content: 'Revert Content', summary: 'Revert Summary' }]]); // SELECT blog_revisions WHERE id = ?
      mockQuery.mockResolvedValueOnce([[]]); // INSERT current to blog_revisions
      mockQuery.mockResolvedValueOnce([[]]); // UPDATE blogs to rollbacked values

      const response = await request(app)
        .post('/api/v1/blog/admin/blogs/12/rollback/9')
        .send();

      expect(response.statusCode).toBe(200);
      expect(response.body.status).toBe('success');
      expect(response.body.data.title).toBe('Revert Title');

      // Verify rollback updates applied
      const updateCall = mockQuery.mock.calls.find(call => 
        typeof call[0] === 'string' && call[0].includes('UPDATE blogs SET title = ?')
      );
      expect(updateCall).toBeDefined();
      expect(updateCall[1][0]).toBe('Revert Title');
      expect(updateCall[1][1]).toBe('Revert Content');
    });
  });
});
