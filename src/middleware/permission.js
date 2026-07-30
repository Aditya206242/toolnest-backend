const db = require('../config/db');

/**
 * Dynamic permission guard middleware.
 * Verifies if the authenticated user's role is permitted to execute the target action.
 */
module.exports = (permission) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication required. Please sign in.'
        });
      }

      const { role } = req.user;

      // Admin bypasses all role restrictions
      if (role === 'admin') {
        return next();
      }

      // Check permission matrix config in DB
      const [rows] = await db.query(
        'SELECT is_allowed FROM role_permissions WHERE role = ? AND permission = ?',
        [role, permission]
      );

      if (rows.length > 0 && !rows[0].is_allowed) {
        return res.status(403).json({
          status: 'error',
          code: 'PERMISSION_DENIED',
          message: `Access Denied. Your account level (${role}) is not authorized to access: ${permission}. Please upgrade your subscription.`
        });
      }

      next();
    } catch (err) {
      console.error(`[Permission Guard Error] Failed checking "${permission}" for role:`, err.message);
      next(); // Fail-open fallback to prevent system lockout on DB connectivity issues
    }
  };
};
