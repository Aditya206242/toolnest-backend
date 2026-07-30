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

describe('Admin Control Center Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnection.mockResolvedValue(mockConnection);
  });

  describe('GET /api/v1/admin/dashboard/overview', () => {
    test('should query users, subs, payments, charts and timelines', async () => {
      // Setup queries
      mockQuery.mockResolvedValueOnce([[{ total: 50 }]]); // total users
      mockQuery.mockResolvedValueOnce([[{ total: 10 }]]); // premium users
      mockQuery.mockResolvedValueOnce([[{ total: 8 }]]); // active subs
      mockQuery.mockResolvedValueOnce([[{ total: 500.5 }]]); // total revenue
      mockQuery.mockResolvedValueOnce([[{ date: '2026-07-28', requests: 12 }]]); // usage chart
      mockQuery.mockResolvedValueOnce([[{ date: '2026-07-28', revenue: 99.0 }]]); // revenue chart
      mockQuery.mockResolvedValueOnce([[{ id: 1, action: 'ADMIN_LOGIN', details: 'Success', created_at: '2026-07-28' }]]); // timeline

      const response = await request(app)
        .get('/api/v1/admin/dashboard/overview')
        .send();

      expect(response.statusCode).toBe(200);
      expect(response.body.data.stats.totalUsers).toBe(50);
      expect(response.body.data.stats.totalRevenue).toBe(500.5);
      expect(response.body.data.charts.usageChart[0].requests).toBe(12);
    });
  });

  describe('PUT /api/v1/admin/dashboard/users/:id/role self-change restriction', () => {
    test('should return 400 error when trying to update own admin role', async () => {
      mockQuery.mockResolvedValueOnce([[{ full_name: 'Admin Name', email: 'admin@toolnest.com', role: 'admin' }]]);

      const response = await request(app)
        .put('/api/v1/admin/dashboard/users/1/role') // id = 1 matches mocked req.user.id
        .send({ role: 'user' });

      expect(response.statusCode).toBe(400);
      expect(response.body.status).toBe('error');
      expect(response.body.message).toContain('You cannot change your own role');
    });
  });

  describe('GET & PUT Permission Matrix settings', () => {
    test('GET /permissions should query role_permissions data', async () => {
      mockQuery.mockResolvedValueOnce([[{ role: 'user', permission: 'image_remove_bg', is_allowed: 0 }]]);

      const response = await request(app)
        .get('/api/v1/admin/dashboard/permissions')
        .send();

      expect(response.statusCode).toBe(200);
      expect(response.body.data[0].permission).toBe('image_remove_bg');
    });

    test('PUT /permissions should update matrix entries and write action logs', async () => {
      mockQuery.mockResolvedValueOnce([[]]); // UPDATE table query
      mockQuery.mockResolvedValueOnce([[]]); // logAdminAction DDL insert

      const response = await request(app)
        .put('/api/v1/admin/dashboard/permissions')
        .send({ role: 'user', permission: 'image_remove_bg', isAllowed: true });

      expect(response.statusCode).toBe(200);
      expect(response.body.status).toBe('success');
      
      const insertCall = mockQuery.mock.calls.find(call => 
        typeof call[0] === 'string' && call[0].includes('INSERT INTO role_permissions')
      );
      expect(insertCall).toBeDefined();
    });
  });

  describe('GET /api/v1/admin/dashboard/live-stats', () => {
    test('should query active MySQL threads and fetch system averages', async () => {
      mockQuery.mockResolvedValueOnce([[{ Value: '5' }]]); // Threads_connected count

      const response = await request(app)
        .get('/api/v1/admin/dashboard/live-stats')
        .send();

      expect(response.statusCode).toBe(200);
      expect(response.body.data.database.activeConnections).toBe(5);
      expect(response.body.data.cpuLoad).toBeDefined();
      expect(response.body.data.memoryUsage.rss).toBeDefined();
    });
  });

  describe('Dynamic Permission Middleware check', () => {
    // We can import our permission checker middleware directly to test its execution flow
    const permissionCheck = require('../src/middleware/permission');

    test('should call next() if user role is admin', async () => {
      const middleware = permissionCheck('image_remove_bg');
      const req = { user: { role: 'admin' } };
      const res = {};
      const next = jest.fn();

      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('should return 403 status if user role does not possess permissions', async () => {
      const middleware = permissionCheck('image_remove_bg');
      const req = { user: { role: 'user' } };
      
      // Mock db response: is_allowed = 0
      mockQuery.mockResolvedValueOnce([[{ is_allowed: 0 }]]);

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      await middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        status: 'error',
        code: 'PERMISSION_DENIED'
      }));
      expect(next).not.toHaveBeenCalled();
    });
  });
});
