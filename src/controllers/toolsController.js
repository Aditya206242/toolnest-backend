const db = require('../config/db');

// Controller to log tool execution metrics
exports.logUsage = async (req, res, next) => {
  try {
    const { toolSlug } = req.body;
    if (!toolSlug) {
      return res.status(400).json({
        status: 'error',
        message: 'Tool slug is required.',
      });
    }

    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
    const today = new Date().toISOString().split('T')[0];
    const userId = req.user ? req.user.id : null;

    // Resolve Tool ID from slug
    const [tools] = await db.query('SELECT id FROM tools WHERE slug = ?', [toolSlug]);
    if (tools.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: `Tool with slug '${toolSlug}' not found.`,
      });
    }
    const toolId = tools[0].id;

    // 1. Log activity audit log
    await db.query(
      'INSERT INTO activity_logs (user_id, action, ip_address, details) VALUES (?, ?, ?, ?)',
      [userId, 'tool_execution', ipAddress, `Executed tool: ${toolSlug}`]
    );

    // 2. Increment daily usage metrics
    await db.query(
      `INSERT INTO tool_usage (user_id, tool_id, request_count, source, usage_date) 
       VALUES (?, ?, 1, 'web', ?) 
       ON DUPLICATE KEY UPDATE request_count = request_count + 1`,
      [userId, toolId, today]
    );

    res.status(200).json({
      status: 'success',
      message: 'Tool execution logged successfully.',
    });
  } catch (error) {
    next(error);
  }
};

// Controller to check if a user is within their limits before launching a tool
exports.checkLimits = async (req, res, next) => {
  try {
    // Bypassed for testing purposes (unlimited access)
    return res.status(200).json({
      status: 'success',
      allowed: true,
      limit: -1,
      usage: 0,
    });
  } catch (error) {
    next(error);
  }
};
