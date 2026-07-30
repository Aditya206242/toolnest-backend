const jwt = require('jsonwebtoken');

// Soft Authentication: Extracts user profile if JWT is present, does not reject if absent
module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(
        token, 
        process.env.JWT_SECRET || 'super_secret_jwt_sign_key_change_in_production'
      );
      req.user = decoded;
    } catch (error) {
      // Soft auth validation fails silently to treat invalid sessions as anonymous calls
    }
  }

  next();
};
