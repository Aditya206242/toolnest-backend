const multer = require('multer');

// Configure storage in memory to avoid writing transient file chunks to host disk
const storage = multer.memoryStorage();

// Validate file mimetype
const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Invalid file format. Only PDF files are supported.'), false);
  }
};

// Set limits (10MB per file)
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB in bytes
  },
  fileFilter: fileFilter,
});

module.exports = upload;
