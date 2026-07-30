const imageService = require('../services/imageService');
const db = require('../config/db');
const archiver = require('archiver');
const { PassThrough } = require('stream');

// Helper to log image tool executions in the database for analytics and rate-limiting
const logToolExecution = async (req, toolSlug) => {
  try {
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
    const today = new Date().toISOString().split('T')[0];
    const userId = req.user ? req.user.id : null;

    const [tools] = await db.query('SELECT id FROM tools WHERE slug = ?', [toolSlug]);
    if (tools.length === 0) {
      console.warn(`[Analytics Warning] Image tool slug '${toolSlug}' not found in database.`);
      return;
    }
    const toolId = tools[0].id;

    // 1. Audit trail log
    await db.query(
      'INSERT INTO activity_logs (user_id, action, ip_address, details) VALUES (?, ?, ?, ?)',
      [userId, 'tool_execution', ipAddress, `Executed tool: ${toolSlug}`]
    );

    // 2. Daily limits tracking increment
    await db.query(
      `INSERT INTO tool_usage (user_id, tool_id, request_count, source, usage_date) 
       VALUES (?, ?, 1, 'web', ?) 
       ON DUPLICATE KEY UPDATE request_count = request_count + 1`,
      [userId, toolId, today]
    );
  } catch (error) {
    console.error('[Analytics Log Fail]', error.message);
  }
};

exports.compress = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No image file uploaded.' });
    }

    const resultBuffer = await imageService.compress(req.file, req.body);
    
    await logToolExecution(req, 'image-compress');

    const targetFormat = (req.body.format || '').toLowerCase();
    let mimeType = req.file.mimetype;

    if (targetFormat === 'auto') {
      const sharp = require('sharp');
      try {
        const metadata = await sharp(req.file.buffer).metadata();
        if (metadata.hasAlpha) mimeType = 'image/webp';
        else if (metadata.format === 'png' || metadata.format === 'gif') mimeType = 'image/webp';
        else if (metadata.format === 'heif' || metadata.format === 'avif') mimeType = 'image/avif';
        else mimeType = 'image/jpeg';
      } catch (err) {
        mimeType = 'image/jpeg';
      }
    } else {
      if (targetFormat === 'png') mimeType = 'image/png';
      else if (targetFormat === 'webp') mimeType = 'image/webp';
      else if (targetFormat === 'avif') mimeType = 'image/avif';
      else if (targetFormat === 'jpeg' || targetFormat === 'jpg') mimeType = 'image/jpeg';
    }

    res.setHeader('Content-Type', mimeType);
    res.send(resultBuffer);
  } catch (error) {
    next(error);
  }
};

exports.resize = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No image file uploaded.' });
    }

    const { width, height } = req.body;
    const resultBuffer = await imageService.resize(req.file, parseInt(width), parseInt(height));

    await logToolExecution(req, 'image-resize');

    res.setHeader('Content-Type', req.file.mimetype);
    res.send(resultBuffer);
  } catch (error) {
    next(error);
  }
};

exports.crop = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No image file uploaded.' });
    }

    const { x, y, width, height } = req.body;
    const resultBuffer = await imageService.crop(req.file, { x, y, width, height });

    await logToolExecution(req, 'image-crop');

    res.setHeader('Content-Type', req.file.mimetype);
    res.send(resultBuffer);
  } catch (error) {
    next(error);
  }
};

exports.convert = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No image file uploaded.' });
    }

    const { targetFormat } = req.body;
    const resultBuffer = await imageService.convert(req.file, targetFormat);

    await logToolExecution(req, 'image-convert');

    // Map mimetype based on target format
    let mimeType = 'image/jpeg';
    if (targetFormat === 'png') mimeType = 'image/png';
    else if (targetFormat === 'webp') mimeType = 'image/webp';
    else if (targetFormat === 'avif') mimeType = 'image/avif';

    res.setHeader('Content-Type', mimeType);
    res.send(resultBuffer);
  } catch (error) {
    next(error);
  }
};

exports.rotate = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No image file uploaded.' });
    }

    // Input Validation
    const { degrees, quality, backgroundColor } = req.body;
    if (degrees !== undefined) {
      const parsedDeg = parseInt(degrees, 10);
      if (isNaN(parsedDeg) || parsedDeg < -360 || parsedDeg > 360) {
        return res.status(400).json({ status: 'error', message: 'Degrees must be a number between -360 and 360.' });
      }
    }
    if (quality !== undefined) {
      const parsedQual = parseInt(quality, 10);
      if (isNaN(parsedQual) || parsedQual < 10 || parsedQual > 100) {
        return res.status(400).json({ status: 'error', message: 'Quality must be a number between 10 and 100.' });
      }
    }
    if (backgroundColor && !/^#([0-9A-Fa-f]{3}){1,2}$/.test(backgroundColor)) {
      return res.status(400).json({ status: 'error', message: 'Background color must be a valid hex color code (e.g. #ffffff).' });
    }

    const { buffer: resultBuffer, format: finalFormat } = await imageService.rotate(req.file, req.body);

    await logToolExecution(req, 'image-rotate');

    let mimeType = 'image/png';
    if (finalFormat === 'jpeg' || finalFormat === 'jpg') mimeType = 'image/jpeg';
    else if (finalFormat === 'webp') mimeType = 'image/webp';
    else if (finalFormat === 'avif') mimeType = 'image/avif';
    else if (finalFormat === 'gif') mimeType = 'image/gif';
    else if (finalFormat === 'tiff') mimeType = 'image/tiff';
    else if (finalFormat === 'heif' || finalFormat === 'heic') mimeType = 'image/heif';

    res.setHeader('Content-Type', mimeType);
    res.send(resultBuffer);
  } catch (error) {
    next(error);
  }
};

exports.rotateBatch = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No image files uploaded for batch rotation.' });
    }

    // Input Validation
    const { degrees, quality, backgroundColor } = req.body;
    if (degrees !== undefined) {
      const parsedDeg = parseInt(degrees, 10);
      if (isNaN(parsedDeg) || parsedDeg < -360 || parsedDeg > 360) {
        return res.status(400).json({ status: 'error', message: 'Degrees must be a number between -360 and 360.' });
      }
    }
    if (quality !== undefined) {
      const parsedQual = parseInt(quality, 10);
      if (isNaN(parsedQual) || parsedQual < 10 || parsedQual > 100) {
        return res.status(400).json({ status: 'error', message: 'Quality must be a number between 10 and 100.' });
      }
    }
    if (backgroundColor && !/^#([0-9A-Fa-f]{3}){1,2}$/.test(backgroundColor)) {
      return res.status(400).json({ status: 'error', message: 'Background color must be a valid hex color code (e.g. #ffffff).' });
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const zipStream = new PassThrough();
    const buffers = [];

    zipStream.on('data', (chunk) => buffers.push(chunk));
    
    const zipPromise = new Promise((resolve, reject) => {
      zipStream.on('end', () => resolve(Buffer.concat(buffers)));
      zipStream.on('error', (err) => reject(err));
    });

    archive.pipe(zipStream);

    for (const file of req.files) {
      const { buffer: resultBuffer, format: finalFormat } = await imageService.rotate(file, req.body);
      
      const originalName = file.originalname;
      const nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
      const filename = `rotated_${nameWithoutExt}.${finalFormat}`;
      archive.append(resultBuffer, { name: filename });
    }

    await archive.finalize();
    const zipBuffer = await zipPromise;

    await logToolExecution(req, 'image-rotate');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=rotated_images_${Date.now()}.zip`);
    res.send(zipBuffer);
  } catch (error) {
    next(error);
  }
};

exports.watermark = async (req, res, next) => {
  try {
    const baseFile = req.file || (req.files && req.files.image ? req.files.image[0] : null);
    if (!baseFile) {
      return res.status(400).json({ status: 'error', message: 'No target base image uploaded.' });
    }

    const watermarkType = req.body.watermarkType || 'text';
    if (!['text', 'image', 'svg'].includes(watermarkType)) {
      return res.status(400).json({ status: 'error', message: 'Invalid watermarkType. Must be text, image, or svg.' });
    }

    const watermarkFile = req.files && req.files.watermark ? req.files.watermark[0] : null;
    if ((watermarkType === 'image' || watermarkType === 'svg') && !watermarkFile) {
      return res.status(400).json({ status: 'error', message: `Watermark file is required for ${watermarkType} watermarking.` });
    }

    // Input validations
    if (req.body.opacity !== undefined) {
      const parsedOpacity = parseFloat(req.body.opacity);
      if (isNaN(parsedOpacity) || parsedOpacity < 0 || parsedOpacity > 1) {
        return res.status(400).json({ status: 'error', message: 'Opacity must be a float between 0 and 1.' });
      }
    }
    if (req.body.scale !== undefined) {
      const parsedScale = parseFloat(req.body.scale);
      if (isNaN(parsedScale) || parsedScale < 0.05 || parsedScale > 2) {
        return res.status(400).json({ status: 'error', message: 'Scale must be a float between 0.05 and 2.' });
      }
    }
    if (req.body.rotation !== undefined) {
      const parsedRot = parseInt(req.body.rotation, 10);
      if (isNaN(parsedRot) || parsedRot < -360 || parsedRot > 360) {
        return res.status(400).json({ status: 'error', message: 'Rotation must be a number between -360 and 360.' });
      }
    }
    const VALID_BLEND_MODES = [
      'clear', 'source', 'over', 'in', 'out', 'atop', 'dest', 'dest-over',
      'dest-in', 'dest-out', 'dest-atop', 'xor', 'add', 'saturate', 'difference',
      'exclusion', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
      'color-dodge', 'color-burn', 'hard-light', 'soft-light'
    ];
    if (req.body.blendMode && !VALID_BLEND_MODES.includes(req.body.blendMode)) {
      return res.status(400).json({ status: 'error', message: 'Invalid blendMode option.' });
    }

    const fontFile = req.files && req.files.fontFile ? req.files.fontFile[0] : null;

    const resultBuffer = await imageService.watermark(baseFile, watermarkFile, req.body, fontFile);

    await logToolExecution(req, 'image-watermark');

    res.setHeader('Content-Type', baseFile.mimetype);
    res.send(resultBuffer);
  } catch (error) {
    next(error);
  }
};

exports.watermarkBatch = async (req, res, next) => {
  try {
    const baseFiles = req.files && req.files.images ? req.files.images : [];
    if (baseFiles.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No base images uploaded for batch watermarking.' });
    }

    const watermarkType = req.body.watermarkType || 'text';
    if (!['text', 'image', 'svg'].includes(watermarkType)) {
      return res.status(400).json({ status: 'error', message: 'Invalid watermarkType. Must be text, image, or svg.' });
    }

    const watermarkFile = req.files && req.files.watermark ? req.files.watermark[0] : null;
    if ((watermarkType === 'image' || watermarkType === 'svg') && !watermarkFile) {
      return res.status(400).json({ status: 'error', message: `Watermark file is required for ${watermarkType} watermarking.` });
    }

    // Input validations
    if (req.body.opacity !== undefined) {
      const parsedOpacity = parseFloat(req.body.opacity);
      if (isNaN(parsedOpacity) || parsedOpacity < 0 || parsedOpacity > 1) {
        return res.status(400).json({ status: 'error', message: 'Opacity must be a float between 0 and 1.' });
      }
    }
    if (req.body.scale !== undefined) {
      const parsedScale = parseFloat(req.body.scale);
      if (isNaN(parsedScale) || parsedScale < 0.05 || parsedScale > 2) {
        return res.status(400).json({ status: 'error', message: 'Scale must be a float between 0.05 and 2.' });
      }
    }
    if (req.body.rotation !== undefined) {
      const parsedRot = parseInt(req.body.rotation, 10);
      if (isNaN(parsedRot) || parsedRot < -360 || parsedRot > 360) {
        return res.status(400).json({ status: 'error', message: 'Rotation must be a number between -360 and 360.' });
      }
    }
    const VALID_BLEND_MODES = [
      'clear', 'source', 'over', 'in', 'out', 'atop', 'dest', 'dest-over',
      'dest-in', 'dest-out', 'dest-atop', 'xor', 'add', 'saturate', 'difference',
      'exclusion', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
      'color-dodge', 'color-burn', 'hard-light', 'soft-light'
    ];
    if (req.body.blendMode && !VALID_BLEND_MODES.includes(req.body.blendMode)) {
      return res.status(400).json({ status: 'error', message: 'Invalid blendMode option.' });
    }

    const fontFile = req.files && req.files.fontFile ? req.files.fontFile[0] : null;

    const archive = archiver('zip', { zlib: { level: 9 } });
    const zipStream = new PassThrough();
    const buffers = [];

    zipStream.on('data', (chunk) => buffers.push(chunk));
    
    const zipPromise = new Promise((resolve, reject) => {
      zipStream.on('end', () => resolve(Buffer.concat(buffers)));
      zipStream.on('error', (err) => reject(err));
    });

    archive.pipe(zipStream);

    for (const file of baseFiles) {
      const resultBuffer = await imageService.watermark(file, watermarkFile, req.body, fontFile);
      const filename = `watermarked_${file.originalname}`;
      archive.append(resultBuffer, { name: filename });
    }

    await archive.finalize();
    const zipBuffer = await zipPromise;

    await logToolExecution(req, 'image-watermark');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=watermarked_images_${Date.now()}.zip`);
    res.send(zipBuffer);
  } catch (error) {
    next(error);
  }
};

exports.removeBackground = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No image file uploaded.' });
    }

    // Input Validation
    const { edgeSmoothing, autoCrop } = req.body;
    if (edgeSmoothing !== undefined && edgeSmoothing !== 'true' && edgeSmoothing !== 'false' && typeof edgeSmoothing !== 'boolean') {
      return res.status(400).json({ status: 'error', message: 'edgeSmoothing must be a boolean.' });
    }
    if (autoCrop !== undefined && autoCrop !== 'true' && autoCrop !== 'false' && typeof autoCrop !== 'boolean') {
      return res.status(400).json({ status: 'error', message: 'autoCrop must be a boolean.' });
    }

    const resultBuffer = await imageService.removeBackground(req.file, req.body);

    await logToolExecution(req, 'image-remove-bg');

    res.setHeader('Content-Type', 'image/png'); // bg remove yields transparency, hence PNG
    res.send(resultBuffer);
  } catch (error) {
    next(error);
  }
};

exports.removeBackgroundBatch = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No image files uploaded for batch background removal.' });
    }

    // Input Validation
    const { edgeSmoothing, autoCrop } = req.body;
    if (edgeSmoothing !== undefined && edgeSmoothing !== 'true' && edgeSmoothing !== 'false' && typeof edgeSmoothing !== 'boolean') {
      return res.status(400).json({ status: 'error', message: 'edgeSmoothing must be a boolean.' });
    }
    if (autoCrop !== undefined && autoCrop !== 'true' && autoCrop !== 'false' && typeof autoCrop !== 'boolean') {
      return res.status(400).json({ status: 'error', message: 'autoCrop must be a boolean.' });
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const zipStream = new PassThrough();
    const buffers = [];

    zipStream.on('data', (chunk) => buffers.push(chunk));
    
    const zipPromise = new Promise((resolve, reject) => {
      zipStream.on('end', () => resolve(Buffer.concat(buffers)));
      zipStream.on('error', (err) => reject(err));
    });

    archive.pipe(zipStream);

    for (const file of req.files) {
      const resultBuffer = await imageService.removeBackground(file, req.body);
      const nameWithoutExt = file.originalname.substring(0, file.originalname.lastIndexOf('.')) || file.originalname;
      const filename = `no-bg_${nameWithoutExt}.png`; // Output is always transparent PNG
      archive.append(resultBuffer, { name: filename });
    }

    await archive.finalize();
    const zipBuffer = await zipPromise;

    await logToolExecution(req, 'image-remove-bg');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=no-bg_images_${Date.now()}.zip`);
    res.send(zipBuffer);
  } catch (error) {
    next(error);
  }
};

exports.aiUpscale = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No image file uploaded.' });
    }

    // Input Validation
    const { scale, noiseReduction, sharpen, faceEnhancement } = req.body;
    if (scale !== undefined && !['2x', '4x', '8x'].includes(scale)) {
      return res.status(400).json({ status: 'error', message: 'Scale must be 2x, 4x, or 8x.' });
    }
    if (noiseReduction !== undefined && !['off', 'low', 'medium', 'high'].includes(noiseReduction)) {
      return res.status(400).json({ status: 'error', message: 'noiseReduction must be off, low, medium, or high.' });
    }
    if (sharpen !== undefined && !['off', 'low', 'medium', 'high'].includes(sharpen)) {
      return res.status(400).json({ status: 'error', message: 'Sharpen must be off, low, medium, or high.' });
    }
    if (faceEnhancement !== undefined && faceEnhancement !== 'true' && faceEnhancement !== 'false' && typeof faceEnhancement !== 'boolean') {
      return res.status(400).json({ status: 'error', message: 'faceEnhancement must be a boolean.' });
    }

    const resultBuffer = await imageService.aiUpscale(req.file, req.body);

    await logToolExecution(req, 'image-ai-upscale');

    res.setHeader('Content-Type', req.file.mimetype);
    res.send(resultBuffer);
  } catch (error) {
    next(error);
  }
};

exports.aiUpscaleBatch = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No image files uploaded for batch upscaling.' });
    }

    // Input Validation
    const { scale, noiseReduction, sharpen, faceEnhancement } = req.body;
    if (scale !== undefined && !['2x', '4x', '8x'].includes(scale)) {
      return res.status(400).json({ status: 'error', message: 'Scale must be 2x, 4x, or 8x.' });
    }
    if (noiseReduction !== undefined && !['off', 'low', 'medium', 'high'].includes(noiseReduction)) {
      return res.status(400).json({ status: 'error', message: 'noiseReduction must be off, low, medium, or high.' });
    }
    if (sharpen !== undefined && !['off', 'low', 'medium', 'high'].includes(sharpen)) {
      return res.status(400).json({ status: 'error', message: 'Sharpen must be off, low, medium, or high.' });
    }
    if (faceEnhancement !== undefined && faceEnhancement !== 'true' && faceEnhancement !== 'false' && typeof faceEnhancement !== 'boolean') {
      return res.status(400).json({ status: 'error', message: 'faceEnhancement must be a boolean.' });
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const zipStream = new PassThrough();
    const buffers = [];

    zipStream.on('data', (chunk) => buffers.push(chunk));
    
    const zipPromise = new Promise((resolve, reject) => {
      zipStream.on('end', () => resolve(Buffer.concat(buffers)));
      zipStream.on('error', (err) => reject(err));
    });

    archive.pipe(zipStream);

    for (const file of req.files) {
      const resultBuffer = await imageService.aiUpscale(file, req.body);
      const nameWithoutExt = file.originalname.substring(0, file.originalname.lastIndexOf('.')) || file.originalname;
      const ext = file.originalname.split('.').pop();
      const filename = `upscaled_${nameWithoutExt}.${ext}`;
      archive.append(resultBuffer, { name: filename });
    }

    await archive.finalize();
    const zipBuffer = await zipPromise;

    await logToolExecution(req, 'image-ai-upscale');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=upscaled_images_${Date.now()}.zip`);
    res.send(zipBuffer);
  } catch (error) {
    next(error);
  }
};

exports.getMetadata = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No image file uploaded.' });
    }

    const metadata = await imageService.getMetadata(req.file);

    await logToolExecution(req, 'image-metadata');

    res.status(200).json({
      status: 'success',
      data: metadata
    });
  } catch (error) {
    next(error);
  }
};

exports.removeMetadata = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No image file uploaded.' });
    }

    const resultBuffer = await imageService.removeMetadata(req.file);

    await logToolExecution(req, 'image-metadata');

    res.setHeader('Content-Type', req.file.mimetype);
    res.send(resultBuffer);
  } catch (error) {
    next(error);
  }
};

exports.removeMetadataBatch = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No image files uploaded for batch cleaning.' });
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const zipStream = new PassThrough();
    const buffers = [];

    zipStream.on('data', (chunk) => buffers.push(chunk));
    
    const zipPromise = new Promise((resolve, reject) => {
      zipStream.on('end', () => resolve(Buffer.concat(buffers)));
      zipStream.on('error', (err) => reject(err));
    });

    archive.pipe(zipStream);

    for (const file of req.files) {
      const resultBuffer = await imageService.removeMetadata(file);
      const nameWithoutExt = file.originalname.substring(0, file.originalname.lastIndexOf('.')) || file.originalname;
      const ext = file.originalname.split('.').pop();
      const filename = `cleaned_${nameWithoutExt}.${ext}`;
      archive.append(resultBuffer, { name: filename });
    }

    await archive.finalize();
    const zipBuffer = await zipPromise;

    await logToolExecution(req, 'image-metadata');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=cleaned_images_${Date.now()}.zip`);
    res.send(zipBuffer);
  } catch (error) {
    next(error);
  }
};
