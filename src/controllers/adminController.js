const db = require('../config/db');
const os = require('os');

// helper: Log administrative action in audit logs
const logAdminAction = async (userId, action, details, ipAddress = null) => {
  try {
    await db.query(
      'INSERT INTO activity_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [userId, action, details, ipAddress]
    );
  } catch (err) {
    console.error('Failed to log admin action:', err.message);
  }
};

// 1. GET /api/v1/admin/dashboard/overview
exports.getOverview = async (req, res, next) => {
  try {
    // Basic stats counters
    const [[{ total: totalUsers }]] = await db.query('SELECT COUNT(*) as total FROM users');
    const [[{ total: premiumUsers }]] = await db.query("SELECT COUNT(*) as total FROM users WHERE role = 'premium'");
    const [[{ total: activeSubs }]] = await db.query("SELECT COUNT(*) as total FROM subscriptions WHERE status = 'active'");
    const [[{ total: rawRevenue }]] = await db.query("SELECT SUM(amount) as total FROM payments WHERE status = 'succeeded'");
    
    const totalRevenue = parseFloat(rawRevenue || 0);

    // Fetch daily usage chart metrics (last 7 days)
    const [usageChart] = await db.query(`
      SELECT 
        DATE_FORMAT(usage_date, '%Y-%m-%d') as date, 
        SUM(request_count) as requests
      FROM tool_usage
      WHERE usage_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY usage_date
      ORDER BY usage_date ASC
    `);

    // Fetch daily revenue chart metrics (last 7 days)
    const [revenueChart] = await db.query(`
      SELECT 
        DATE_FORMAT(created_at, '%Y-%m-%d') as date, 
        SUM(amount) as revenue
      FROM payments
      WHERE status = 'succeeded' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    // Fetch recent activity timeline events (last 15 logs)
    const [timeline] = await db.query(`
      SELECT 
        l.id, l.action, l.details, l.created_at, l.ip_address,
        u.full_name as user_name, u.email as user_email
      FROM activity_logs l
      LEFT JOIN users u ON l.user_id = u.id
      ORDER BY l.created_at DESC
      LIMIT 15
    `);

    res.status(200).json({
      status: 'success',
      data: {
        stats: {
          totalUsers,
          premiumUsers,
          activeSubs,
          totalRevenue
        },
        charts: {
          usageChart,
          revenueChart
        },
        timeline
      }
    });
  } catch (error) {
    next(error);
  }
};

// 2. GET /api/v1/admin/dashboard/users
exports.getUsers = async (req, res, next) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : null;
    const role = req.query.role || null;

    let sql = `
      SELECT u.id, u.email, u.full_name, u.role, u.is_verified, u.created_at,
             COALESCE(s.plan_name, 'free') as plan_name, s.status as subscription_status
      FROM users u
      LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ' AND (u.email LIKE ? OR u.full_name LIKE ?)';
      params.push(search, search);
    }

    if (role) {
      sql += ' AND u.role = ?';
      params.push(role);
    }

    sql += ' ORDER BY u.created_at DESC';

    const [users] = await db.query(sql, params);
    res.status(200).json({ status: 'success', data: users });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/admin/dashboard/users/:id/role
exports.updateUserRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['user', 'premium', 'admin'].includes(role)) {
      return res.status(400).json({ status: 'error', message: 'Invalid role provided.' });
    }

    const [userCheck] = await db.query('SELECT full_name, email, role FROM users WHERE id = ?', [id]);
    if (userCheck.length === 0) {
      return res.status(404).json({ status: 'error', message: 'User not found.' });
    }
    const targetUser = userCheck[0];

    // Restrict changing own role to prevent admin self-lockout
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ status: 'error', message: 'You cannot change your own role.' });
    }

    await db.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);

    // Log the configuration adjustment
    await logAdminAction(
      req.user.id,
      'USER_ROLE_CHANGE',
      `Changed role of ${targetUser.full_name} (${targetUser.email}) from ${targetUser.role} to ${role}`,
      req.ip
    );

    res.status(200).json({ status: 'success', message: 'User role updated successfully.' });
  } catch (error) {
    next(error);
  }
};

// 3. GET /api/v1/admin/dashboard/payments
exports.getPayments = async (req, res, next) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : null;

    let sql = `
      SELECT p.*, u.full_name as user_name, u.email as user_email
      FROM payments p
      JOIN users u ON p.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ' AND (p.transaction_id LIKE ? OR u.email LIKE ? OR u.full_name LIKE ?)';
      params.push(search, search, search);
    }

    sql += ' ORDER BY p.created_at DESC';

    const [payments] = await db.query(sql, params);
    res.status(200).json({ status: 'success', data: payments });
  } catch (error) {
    next(error);
  }
};

// 4. GET /api/v1/admin/dashboard/tools (Feature Flags management)
exports.getTools = async (req, res, next) => {
  try {
    const [tools] = await db.query(`
      SELECT 
        t.id, t.name, t.slug, t.description, t.category, t.status, t.created_at,
        COALESCE(SUM(tu.request_count), 0) as usage_count
      FROM tools t
      LEFT JOIN tool_usage tu ON t.id = tu.tool_id
      GROUP BY t.id
      ORDER BY t.category ASC, t.name ASC
    `);
    res.status(200).json({ status: 'success', data: tools });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/admin/dashboard/tools/:id/status (Toggle feature flags)
exports.updateToolStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'beta', 'inactive'].includes(status)) {
      return res.status(400).json({ status: 'error', message: 'Invalid tool status provided.' });
    }

    const [toolCheck] = await db.query('SELECT name, status FROM tools WHERE id = ?', [id]);
    if (toolCheck.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Tool not found.' });
    }
    const targetTool = toolCheck[0];

    await db.query('UPDATE tools SET status = ? WHERE id = ?', [status, id]);

    // Log the configuration change
    await logAdminAction(
      req.user.id,
      'TOOL_STATUS_CHANGE',
      `Changed feature flag status of "${targetTool.name}" from ${targetTool.status} to ${status}`,
      req.ip
    );

    res.status(200).json({ status: 'success', message: 'Tool status flag updated successfully.' });
  } catch (error) {
    next(error);
  }
};

// 5. GET /api/v1/admin/dashboard/logs (Audit Trail Logs)
exports.getActivityLogs = async (req, res, next) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : null;
    const action = req.query.action || null;

    let sql = `
      SELECT l.*, u.full_name as user_name, u.email as user_email
      FROM activity_logs l
      LEFT JOIN users u ON l.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ' AND (l.details LIKE ? OR u.email LIKE ? OR u.full_name LIKE ?)';
      params.push(search, search, search);
    }

    if (action) {
      sql += ' AND l.action = ?';
      params.push(action);
    }

    sql += ' ORDER BY l.created_at DESC LIMIT 500';

    const [logs] = await db.query(sql, params);
    res.status(200).json({ status: 'success', data: logs });
  } catch (error) {
    next(error);
  }
};

// 6. GET /api/v1/admin/dashboard/permissions
exports.getPermissions = async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT role, permission, is_allowed FROM role_permissions');
    res.status(200).json({ status: 'success', data: rows });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/admin/dashboard/permissions
exports.updatePermissions = async (req, res, next) => {
  try {
    const { role, permission, isAllowed } = req.body;
    
    if (!['user', 'premium', 'admin'].includes(role)) {
      return res.status(400).json({ status: 'error', message: 'Invalid role.' });
    }

    await db.query(
      'INSERT INTO role_permissions (role, permission, is_allowed) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE is_allowed = ?',
      [role, permission, isAllowed ? 1 : 0, isAllowed ? 1 : 0]
    );

    // Log the change
    await logAdminAction(
      req.user.id,
      'PERMISSION_CHANGE',
      `Changed permission "${permission}" for role "${role}" to ${isAllowed ? 'ALLOWED' : 'DENIED'}`,
      req.ip
    );

    res.status(200).json({ status: 'success', message: 'Permissions Matrix updated.' });
  } catch (error) {
    next(error);
  }
};

// 7. GET /api/v1/admin/dashboard/live-stats
exports.getLiveStats = async (req, res, next) => {
  try {
    // Get MySQL active threads count
    const [[{ Value: threadsConnected }]] = await db.query(
      "SHOW STATUS LIKE 'Threads_connected'"
    );

    const cpuLoad = os.loadavg();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();

    res.status(200).json({
      status: 'success',
      data: {
        serverUptime: Math.round(process.uptime()),
        cpuLoad: cpuLoad[0], // 1-minute load average
        memoryUsage: {
          rss: process.memoryUsage().rss,
          heapTotal: process.memoryUsage().heapTotal,
          heapUsed: process.memoryUsage().heapUsed,
          systemTotal: totalMemory,
          systemFree: freeMemory
        },
        database: {
          activeConnections: parseInt(threadsConnected || 1)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};
