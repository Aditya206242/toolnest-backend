const express = require('express');
const { body, param, validationResult } = require('express-validator');
const authController = require('../controllers/authController');
const router = express.Router();

// Middleware to format validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      status: 'error', 
      errors: errors.array().map(err => ({ field: err.path, message: err.msg }))
    });
  }
  next();
};

// POST /signup
router.post(
  '/signup',
  [
    body('email')
      .isEmail().withMessage('Please provide a valid email address.')
      .normalizeEmail(),
    body('password')
      .isLength({ min: 6 }).withMessage('Password must be at least 6 characters long.'),
    body('fullName')
      .trim()
      .notEmpty().withMessage('Full name is required.')
      .isLength({ max: 100 }).withMessage('Full name cannot exceed 100 characters.')
  ],
  handleValidationErrors,
  authController.signup
);

// POST /login
router.post(
  '/login',
  [
    body('email')
      .isEmail().withMessage('Please provide a valid email address.')
      .normalizeEmail(),
    body('password')
      .notEmpty().withMessage('Password is required.')
  ],
  handleValidationErrors,
  authController.login
);

// POST /refresh
router.post('/refresh', authController.refresh);

// POST /logout
router.post('/logout', authController.logout);

// POST /forgot-password
router.post(
  '/forgot-password',
  [
    body('email')
      .isEmail().withMessage('Please provide a valid email address.')
      .normalizeEmail()
  ],
  handleValidationErrors,
  authController.forgotPassword
);

// POST /reset-password
router.post(
  '/reset-password',
  [
    body('token')
      .notEmpty().withMessage('Reset token is required.'),
    body('password')
      .isLength({ min: 6 }).withMessage('Password must be at least 6 characters long.')
  ],
  handleValidationErrors,
  authController.resetPassword
);

// GET /verify-email/:token
router.get(
  '/verify-email/:token',
  [
    param('token').notEmpty().withMessage('Verification token is required.')
  ],
  handleValidationErrors,
  authController.verifyEmail
);

module.exports = router;
