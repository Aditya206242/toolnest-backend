const multer = require('multer');

// Memory storage to process files directly as buffers without writing to disk
const storage = multer.memoryStorage();

// Validate image mime types
const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'fontFile') {
    if (file.originalname.match(/\.(ttf|otf|woff|woff2)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid font file format. Supported formats: TTF, OTF, WOFF, WOFF2.'), false);
    }
    return;
  }

  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/gif',
    'image/tiff',
    'image/x-tiff',
    'image/heic',
    'image/heif',
    'image/heic-sequence',
    'image/heif-sequence'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid image format. Supported formats: JPG, JPEG, PNG, WEBP, AVIF, GIF, TIFF, HEIC, HEIF.'), false);
  }
};

// Set limits (50MB maximum per file)
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 Megabytes in bytes
  },
  fileFilter: fileFilter,
});

module.exports = upload;
