const express = require('express');
const imageController = require('../controllers/imageController');
const imageUpload = require('../middleware/imageUpload');
const usageLimiter = require('../middleware/usageLimiter');
const softAuth = require('../middleware/softAuth');
const auth = require('../middleware/auth');
const premium = require('../middleware/premium');
const permission = require('../middleware/permission');
const removeBgLimiter = require('../middleware/removeBgLimiter');

const router = express.Router();

// 1. Compress Image
router.post(
  '/compress',
  softAuth,
  usageLimiter,
  imageUpload.single('file'),
  imageController.compress
);

// 2. Resize Image
router.post(
  '/resize',
  softAuth,
  usageLimiter,
  imageUpload.single('file'),
  imageController.resize
);

// 3. Crop Image
router.post(
  '/crop',
  softAuth,
  usageLimiter,
  imageUpload.single('file'),
  imageController.crop
);

// 4. Convert Image
router.post(
  '/convert',
  softAuth,
  usageLimiter,
  imageUpload.single('file'),
  imageController.convert
);

// 5. Rotate Image
router.post(
  '/rotate',
  softAuth,
  usageLimiter,
  imageUpload.single('file'),
  imageController.rotate
);

// 5b. Rotate Image (Batch)
router.post(
  '/rotate-batch',
  softAuth,
  usageLimiter,
  imageUpload.array('files', 20),
  imageController.rotateBatch
);

// 6. Watermark Image
router.post(
  '/watermark',
  softAuth,
  usageLimiter,
  imageUpload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'watermark', maxCount: 1 },
    { name: 'fontFile', maxCount: 1 }
  ]),
  imageController.watermark
);

// 6b. Watermark Image (Batch)
router.post(
  '/watermark-batch',
  softAuth,
  usageLimiter,
  imageUpload.fields([
    { name: 'images', maxCount: 20 },
    { name: 'watermark', maxCount: 1 },
    { name: 'fontFile', maxCount: 1 }
  ]),
  imageController.watermarkBatch
);

// 7. Remove Background
router.post(
  '/remove-background',
  auth,
  permission('image_remove_bg'),
  removeBgLimiter,
  imageUpload.single('file'),
  imageController.removeBackground
);

// 7b. Remove Background (Batch)
router.post(
  '/remove-background-batch',
  auth,
  permission('image_remove_bg'),
  removeBgLimiter,
  imageUpload.array('files', 20),
  imageController.removeBackgroundBatch
);

// 8. AI Upscale
router.post(
  '/ai-upscale',
  auth,
  permission('image_ai_upscale'),
  imageUpload.single('file'),
  imageController.aiUpscale
);

// 8b. AI Upscale (Batch)
router.post(
  '/ai-upscale-batch',
  auth,
  permission('image_ai_upscale'),
  imageUpload.array('files', 20),
  imageController.aiUpscaleBatch
);

// 9. Image Metadata View
router.post(
  '/metadata',
  softAuth,
  usageLimiter,
  imageUpload.single('file'),
  imageController.getMetadata
);

// 9b. Image Metadata Strip (Clean)
router.post(
  '/remove-metadata',
  softAuth,
  usageLimiter,
  imageUpload.single('file'),
  imageController.removeMetadata
);

// 9c. Image Metadata Strip Batch (Clean)
router.post(
  '/remove-metadata-batch',
  softAuth,
  usageLimiter,
  imageUpload.array('files', 20),
  imageController.removeMetadataBatch
);

module.exports = router;
