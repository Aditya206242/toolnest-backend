const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  // Get token from auth header
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      message: 'Access denied. No token provided.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_jwt_sign_key_change_in_production');
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      status: 'error',
      message: 'Invalid or expired token.',
    });
  }
};
