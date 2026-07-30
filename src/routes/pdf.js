const express = require('express');
const pdfController = require('../controllers/pdfController');
const pdfUpload = require('../middleware/pdfUpload');
const usageLimiter = require('../middleware/usageLimiter');
const softAuth = require('../middleware/softAuth');

const router = express.Router();

// 1. Merge PDF
router.post(
  '/merge',
  softAuth,
  usageLimiter,
  pdfUpload.array('files', 20),
  pdfController.merge
);

// 2. Split PDF
router.post(
  '/split',
  softAuth,
  usageLimiter,
  pdfUpload.single('file'),
  pdfController.split
);

// 3. Compress PDF
router.post(
  '/compress',
  softAuth,
  usageLimiter,
  pdfUpload.single('file'),
  pdfController.compress
);

// 4. Rotate PDF
router.post(
  '/rotate',
  softAuth,
  usageLimiter,
  pdfUpload.single('file'),
  pdfController.rotate
);

// 5. Delete Pages
router.post(
  '/delete-pages',
  softAuth,
  usageLimiter,
  pdfUpload.single('file'),
  pdfController.deletePages
);

// 6. Extract Pages
router.post(
  '/extract-pages',
  softAuth,
  usageLimiter,
  pdfUpload.single('file'),
  pdfController.extractPages
);

module.exports = router;
