const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/db');

// Helper to hash tokens for DB storage
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

// Helper to sign JWT Access Token
const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, fullName: user.fullName || user.full_name },
    process.env.JWT_SECRET || 'super_secret_jwt_sign_key_change_in_production',
    { expiresIn: '15m' }
  );
};

// Helper to sign Refresh Token
const generateRefreshToken = () => {
  return crypto.randomBytes(40).toString('hex');
};

// Sign Up Handler
exports.signup = async (req, res, next) => {
  try {
    const { email, password, fullName } = req.body;

    // Check if user already exists
    const [existingUsers] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUsers.length > 0) {
      return res.status(409).json({
        status: 'error',
        message: 'A user with this email address already exists.'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // Generate Verification Token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Insert user into DB
    const [result] = await db.query(
      'INSERT INTO users (email, password_hash, full_name, role, is_verified, verification_token, verification_token_expires) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [email, passwordHash, fullName, 'user', false, verificationToken, tokenExpiry]
    );

    // In production: Send email here. In dev: Log to console.
    console.log(`[Verification Email] Sent to ${email}. Token: ${verificationToken}`);

    res.status(201).json({
      status: 'success',
      message: 'Account registered successfully. Please verify your email.'
    });
  } catch (error) {
    next(error);
  }
};

// Login Handler
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Fetch user
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid email or password.'
      });
    }

    const user = users[0];

    // Check password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid email or password.'
      });
    }

    // Generate Tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();
    const tokenHash = hashToken(refreshToken);

    // Set expiry (7 days)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Save Session to Database
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
    const userAgent = req.headers['user-agent'] || null;

    await db.query(
      'INSERT INTO sessions (user_id, refresh_token_hash, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)',
      [user.id, tokenHash, ipAddress, userAgent, expiresAt]
    );

    // Set HTTP-Only Cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.status(200).json({
      status: 'success',
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        isVerified: !!user.is_verified
      }
    });
  } catch (error) {
    next(error);
  }
};

// Refresh Token Handler (with Rotation)
exports.refresh = async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        status: 'error',
        message: 'Refresh token not found.'
      });
    }

    const tokenHash = hashToken(refreshToken);

    // Find active session
    const [sessions] = await db.query(
      'SELECT s.*, u.email, u.role, u.full_name, u.is_verified FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.refresh_token_hash = ? AND s.is_revoked = FALSE AND s.expires_at > NOW()',
      [tokenHash]
    );

    if (sessions.length === 0) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid or expired session refresh token.'
      });
    }

    const session = sessions[0];
    const user = {
      id: session.user_id,
      email: session.email,
      role: session.role,
      fullName: session.full_name
    };

    // Generate New Tokens (Rotation)
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken();
    const newHash = hashToken(newRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Revoke old session and insert new rotated session
    await db.query('UPDATE sessions SET is_revoked = TRUE WHERE id = ?', [session.id]);
    
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
    const userAgent = req.headers['user-agent'] || null;

    await db.query(
      'INSERT INTO sessions (user_id, refresh_token_hash, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)',
      [user.id, newHash, ipAddress, userAgent, expiresAt]
    );

    // Update Refresh Token Cookie
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.status(200).json({
      status: 'success',
      accessToken: newAccessToken
    });
  } catch (error) {
    next(error);
  }
};

// Logout Handler
exports.logout = async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      // Revoke the session in DB
      await db.query('UPDATE sessions SET is_revoked = TRUE WHERE refresh_token_hash = ?', [tokenHash]);
    }

    // Clear client cookies
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });

    res.status(200).json({
      status: 'success',
      message: 'Logged out successfully.'
    });
  } catch (error) {
    next(error);
  }
};

// Forgot Password Handler
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    const [users] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      // Return 200 for security reasons (prevent user enumeration)
      return res.status(200).json({
        status: 'success',
        message: 'If a matching account exists, a password reset link has been sent.'
      });
    }

    const user = users[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.query(
      'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
      [resetToken, tokenExpiry, user.id]
    );

    // In production: Send email here. In dev: Log to console.
    console.log(`[Reset Password Link] Email: ${email}. Reset Token: ${resetToken}`);

    res.status(200).json({
      status: 'success',
      message: 'If a matching account exists, a password reset link has been sent.'
    });
  } catch (error) {
    next(error);
  }
};

// Reset Password Handler
exports.resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;

    const [users] = await db.query(
      'SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > NOW()',
      [token]
    );

    if (users.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired password reset token.'
      });
    }

    const user = users[0];

    // Hash new password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // Update password and clear reset token columns
    await db.query(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      [passwordHash, user.id]
    );

    res.status(200).json({
      status: 'success',
      message: 'Password has been successfully updated.'
    });
  } catch (error) {
    next(error);
  }
};

// Verify Email Handler
exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params;

    const [users] = await db.query(
      'SELECT id FROM users WHERE verification_token = ? AND verification_token_expires > NOW()',
      [token]
    );

    if (users.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired verification token.'
      });
    }

    const user = users[0];

    // Mark as verified and clear verification tokens
    await db.query(
      'UPDATE users SET is_verified = TRUE, verification_token = NULL, verification_token_expires = NULL WHERE id = ?',
      [user.id]
    );

    res.status(200).json({
      status: 'success',
      message: 'Email verified successfully.'
    });
  } catch (error) {
    next(error);
  }
};

// Update Profile Handler
exports.updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { fullName, password } = req.body;

    if (password) {
      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(password, salt);
      await db.query(
        'UPDATE users SET full_name = ?, password_hash = ? WHERE id = ?',
        [fullName, passwordHash, userId]
      );
    } else {
      await db.query(
        'UPDATE users SET full_name = ? WHERE id = ?',
        [fullName, userId]
      );
    }

    // Fetch updated user to generate new token
    const [users] = await db.query('SELECT id, email, full_name, role, is_verified FROM users WHERE id = ?', [userId]);
    const user = users[0];

    const accessToken = generateAccessToken(user);

    res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully.',
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        isVerified: !!user.is_verified
      }
    });
  } catch (error) {
    next(error);
  }
};

