// Premium Middleware
// Guards endpoints, checking if authenticated user role is premium or admin.
module.exports = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required. Please sign in to access premium features.'
    });
  }

  const { role } = req.user;

  if (role !== 'premium' && role !== 'admin') {
    return res.status(403).json({
      status: 'error',
      code: 'PREMIUM_REQUIRED',
      message: 'This is a premium-only feature. Please upgrade your subscription package to gain access.'
    });
  }

  next();
};
