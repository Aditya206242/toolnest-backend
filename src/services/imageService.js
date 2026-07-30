const sharp = require('sharp');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const path = require('path');

class ImageService {
  constructor() {
    this.removeBgCache = new Map();
    this.maxCacheSize = 50;
  }

  _getCacheKey(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  _setCache(key, buffer) {
    if (this.removeBgCache.size >= this.maxCacheSize) {
      const firstKey = this.removeBgCache.keys().next().value;
      this.removeBgCache.delete(firstKey);
    }
    this.removeBgCache.set(key, buffer);
  }

  runRemoveBgWorker(pixelBuffer, width, height, channels) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, '../workers/removeBgWorker.js'), {
        workerData: { pixelBuffer, width, height, channels }
      });

      worker.on('message', (message) => {
        if (message.status === 'success') {
          resolve(Buffer.from(message.buffer));
        } else {
          reject(new Error(message.error || 'Worker execution failed.'));
        }
      });

      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
      });
    });
  }
  /**
   * Compresses an image buffer using Sharp
   * @param {Object} file - Express Multer file
   * @param {Object} options - Quality, lossless parameters
   * @returns {Promise<Buffer>} - Compressed image buffer
   */
  async compress(file, options = {}) {
    if (!file || !file.buffer) {
      throw new Error('No image file buffer provided for compression.');
    }

    const quality = Math.min(100, Math.max(10, parseInt(options.quality, 10) || 80));
    const lossless = !!options.lossless;

    let pipeline = sharp(file.buffer);

    // Apply advanced resizing if requested
    if (options.resizeEnabled === 'true' || options.resizeEnabled === true) {
      const resizeOptions = { fit: (options.keepAspectRatio === 'true' || options.keepAspectRatio === true) ? 'inside' : 'fill' };
      const w = parseInt(options.resizeWidth, 10);
      const h = parseInt(options.resizeHeight, 10);
      if (!isNaN(w) && w > 0) resizeOptions.width = w;
      if (!isNaN(h) && h > 0) resizeOptions.height = h;
      pipeline = pipeline.resize(resizeOptions);
    }

    // Apply grayscale conversion
    if (options.colorSpace === 'grayscale') {
      pipeline = pipeline.grayscale(true);
    }

    // Apply filters
    if (options.blurAmount && !isNaN(options.blurAmount) && Number(options.blurAmount) > 0) {
      pipeline = pipeline.blur(Number(options.blurAmount));
    }
    if (options.sharpenAmount && !isNaN(options.sharpenAmount) && Number(options.sharpenAmount) > 0) {
      // Apply baseline sharpening
      pipeline = pipeline.sharpen();
    }

    // Keep EXIF metadata (Strip by default)
    const stripMeta = options.stripMetadata !== undefined ? (options.stripMetadata === 'true' || options.stripMetadata === true) : true;
    if (!stripMeta) {
      pipeline = pipeline.withMetadata();
    }

    // Detect format from options or fall back to mimetype
    let targetFormat = (options.format || '').toLowerCase();

    // Smart Compression: Auto-choose the best encoder based on image characteristics
    if (targetFormat === 'auto') {
      try {
        const metadata = await sharp(file.buffer).metadata();
        if (metadata.hasAlpha) {
          targetFormat = 'webp'; // WebP preserves transparency with superior sizes
        } else if (metadata.format === 'png' || metadata.format === 'gif') {
          targetFormat = 'webp'; // Webp replaces heavy graphic formats
        } else if (metadata.format === 'heif' || metadata.format === 'avif') {
          targetFormat = 'avif'; // Retain advanced high efficiency codecs
        } else {
          targetFormat = 'jpeg'; // Default to photo-optimized MozJPEG
        }
      } catch (err) {
        targetFormat = 'jpeg'; // Fallback photo default
      }
    }

    if (!targetFormat) {
      const mime = file.mimetype;
      if (mime === 'image/jpeg' || mime === 'image/jpg') targetFormat = 'jpeg';
      else if (mime === 'image/png') targetFormat = 'png';
      else if (mime === 'image/webp') targetFormat = 'webp';
      else if (mime === 'image/avif') targetFormat = 'avif';
      else if (mime === 'image/gif') targetFormat = 'gif';
      else targetFormat = 'jpeg';
    }

    if (targetFormat === 'jpeg' || targetFormat === 'jpg') {
      const progressive = options.progressiveJpeg !== undefined ? (options.progressiveJpeg === 'true' || options.progressiveJpeg === true) : true;
      const chromaSubsampling = options.chromaSubsampling || '4:2:0';
      return await pipeline
        .jpeg({
          quality,
          mozjpeg: true, // Use high quality mozjpeg encoders
          progressive,
          chromaSubsampling,
          trellisQuantisation: true, // MozJPEG trellis optimization
          overshootDeringing: true,  // Derian overshoot filters
          optimizeScans: true,
          dct: 'float'               // High precision discrete cosine transform
        })
        .toBuffer();
    }

    if (targetFormat === 'png') {
      if (lossless) {
        return await pipeline
          .png({
            compressionLevel: 9, // Maximum lossless compression
            adaptiveFiltering: true, // Filter row optimizations
            progressive: true
          })
          .toBuffer();
      } else {
        // Lossy PNG optimization using palette color quantization (like pngquant)
        return await pipeline
          .png({
            quality,
            compressionLevel: 8,
            palette: true, // Quantize colors to an optimized palette map
            adaptiveFiltering: true,
            progressive: true
          })
          .toBuffer();
      }
    }

    if (targetFormat === 'webp') {
      return await pipeline
        .webp({
          quality,
          lossless,
          smartSubsampling: true, // WebP subsampling optimization
          effort: 6,              // Maximum compression effort CPU effort
          nearLossless: lossless  // Enable near-lossless modes if lossless checked
        })
        .toBuffer();
    }

    if (targetFormat === 'avif') {
      return await pipeline
        .avif({
          quality,
          lossless,
          effort: 5,              // Balance AVIF encoding speed & ratio
          chromaSubsampling: '4:2:0'
        })
        .toBuffer();
    }

    if (targetFormat === 'gif') {
      // GIF optimization
      return await pipeline
        .gif({
          colours: Math.min(256, Math.max(2, Math.round(2.56 * quality))),
          effort: 7 // High GIF compression scans
        })
        .toBuffer();
    }

    // Default fallback to basic compression
    return await pipeline.toBuffer();
  }

  /**
   * Resizes an image buffer
   * @param {Object} file - Express Multer file
   * @param {number} width
   * @param {number} height
   * @returns {Promise<Buffer>}
   */
  async resize(file, width, height) {
    if (!file || !file.buffer) throw new Error('No image file buffer provided for resizing.');

    const resizeOptions = { fit: 'fill' };
    if (width && !isNaN(width)) resizeOptions.width = parseInt(width, 10);
    if (height && !isNaN(height)) resizeOptions.height = parseInt(height, 10);

    return await sharp(file.buffer)
      .resize(resizeOptions)
      .toBuffer();
  }

  /**
   * Crops an image buffer
   * @param {Object} file - Express Multer file
   * @param {Object} coords - x, y, width, height, format, degrees
   * @returns {Promise<Buffer>}
   */
  async crop(file, coords = {}) {
    if (!file || !file.buffer) throw new Error('No image file buffer provided for cropping.');

    const x = Math.max(0, Math.round(parseFloat(coords.x)) || 0);
    const y = Math.max(0, Math.round(parseFloat(coords.y)) || 0);
    const width = Math.round(parseFloat(coords.width));
    const height = Math.round(parseFloat(coords.height));

    if (isNaN(width) || width <= 0 || isNaN(height) || height <= 0) {
      throw new Error('Invalid crop dimensions.');
    }

    let pipeline = sharp(file.buffer);

    // Dynamic rotation if preview was rotated on screen
    if (coords.degrees && !isNaN(coords.degrees)) {
      pipeline = pipeline.rotate(parseInt(coords.degrees, 10));
    }

    const metadata = await pipeline.metadata();
    const imageWidth = metadata.width;
    const imageHeight = metadata.height;

    // Boundary validations and out-of-bounds safety clipping
    const finalX = Math.min(x, imageWidth - 1);
    const finalY = Math.min(y, imageHeight - 1);
    const finalW = Math.min(width, imageWidth - finalX);
    const finalH = Math.min(height, imageHeight - finalY);

    if (finalW <= 0 || finalH <= 0) {
      throw new Error('Crop selection coordinates fall completely out of image boundaries.');
    }

    pipeline = pipeline.extract({
      left: finalX,
      top: finalY,
      width: finalW,
      height: finalH
    });

    let format = (coords.format || '').toLowerCase();
    if (!format) {
      format = metadata.format;
    }

    // Format specific optimizations
    if (format === 'png') {
      pipeline = pipeline.png({ compressionLevel: 8, progressive: true });
    } else if (format === 'webp') {
      pipeline = pipeline.webp({ quality: 85, smartSubsampling: true });
    } else if (format === 'avif') {
      pipeline = pipeline.avif({ quality: 80, effort: 5 });
    } else if (format === 'gif') {
      pipeline = pipeline.gif();
    } else {
      pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true, progressive: true });
    }

    return await pipeline.toBuffer();
  }

  /**
   * Converts an image format
   * @param {Object} file - Express Multer file
   * @param {string} targetFormat - webp, png, jpeg, avif
   * @returns {Promise<Buffer>}
   */
  async convert(file, targetFormat) {
    if (!file || !file.buffer) throw new Error('No image file buffer provided for conversion.');

    const format = targetFormat.toLowerCase();
    const cleanFormat = format === 'jpg' ? 'jpeg' : format;

    return await sharp(file.buffer)
      .toFormat(cleanFormat)
      .toBuffer();
  }

  /**
   * Rotates an image buffer using Sharp
   * @param {Object} file - Express Multer file
   * @param {Object|number} options - Options object containing degrees, flips, background, etc. or direct degrees number
   * @returns {Promise<Buffer>}
   */
  async rotate(file, options = {}) {
    if (!file || !file.buffer) {
      throw new Error('No image file buffer provided for rotation.');
    }

    // Optimize memory: disable sharp cache
    sharp.cache(false);

    // Support options being either an object or a direct degrees value/string
    let degrees = 0;
    let flipHorizontal = false;
    let flipVertical = false;
    let keepTransparency = true;
    let backgroundColor = '#ffffff';
    let preserveMetadata = false;
    let quality = 90;

    if (typeof options === 'object' && options !== null) {
      degrees = parseInt(options.degrees, 10) || 0;
      flipHorizontal = options.flipHorizontal === 'true' || options.flipHorizontal === true;
      flipVertical = options.flipVertical === 'true' || options.flipVertical === true;
      keepTransparency = options.keepTransparency === 'true' || options.keepTransparency === true;
      backgroundColor = options.backgroundColor || '#ffffff';
      preserveMetadata = options.preserveMetadata === 'true' || options.preserveMetadata === true;
      quality = Math.min(100, Math.max(10, parseInt(options.quality, 10) || 90));
    } else {
      degrees = parseInt(options, 10) || 0;
    }

    const isAnimated = file.mimetype === 'image/gif' || file.mimetype === 'image/webp';
    let pipeline = sharp(file.buffer, isAnimated ? { animated: true } : {});

    // Ensure alpha channel if keeping transparency
    if (keepTransparency) {
      pipeline = pipeline.ensureAlpha();
    }

    // Correct orientation first based on EXIF
    pipeline = pipeline.autoOrient();

    // Prepare background color
    let bg = { r: 255, g: 255, b: 255, alpha: 1 };
    if (keepTransparency) {
      bg = { r: 0, g: 0, b: 0, alpha: 0 };
    } else if (backgroundColor) {
      bg = backgroundColor;
    }

    // Apply rotation
    if (degrees !== 0) {
      pipeline = pipeline.rotate(degrees, { background: bg });
    }

    // Apply flip / flop mirroring
    if (flipHorizontal) {
      pipeline = pipeline.flop();
    }
    if (flipVertical) {
      pipeline = pipeline.flip();
    }

    // Preserve metadata (autoOrient resets orientation tag to 1, preventing double rotation)
    if (preserveMetadata) {
      pipeline = pipeline.withMetadata();
    }

    // Determine target format and quality options
    const metadata = await sharp(file.buffer).metadata();
    const format = metadata.format || 'png';
    let targetFormat = format.toLowerCase();

    // Convert non-transparency format (JPEG) to PNG if user wants to keep transparency
    if (keepTransparency && (targetFormat === 'jpeg' || targetFormat === 'jpg')) {
      targetFormat = 'png';
    }

    if (targetFormat === 'jpeg' || targetFormat === 'jpg') {
      pipeline = pipeline.jpeg({ quality, mozjpeg: true, progressive: true });
    } else if (targetFormat === 'png') {
      pipeline = pipeline.png({ compressionLevel: 8, progressive: true });
    } else if (targetFormat === 'webp') {
      pipeline = pipeline.webp({ quality });
    } else if (targetFormat === 'avif') {
      pipeline = pipeline.avif({ quality, effort: 4 });
    } else if (targetFormat === 'gif') {
      pipeline = pipeline.gif();
    } else if (targetFormat === 'tiff') {
      pipeline = pipeline.tiff({ quality });
    } else if (targetFormat === 'heif' || targetFormat === 'heic') {
      pipeline = pipeline.heif({ quality, effort: 4 });
    }

    const outputBuffer = await pipeline.toBuffer();
    return { buffer: outputBuffer, format: targetFormat };
  }

  /**
   * Generates SVG buffer for a text watermark
   * @param {Object} options
   * @param {Object} [fontFile] - Optional custom font file uploaded
   * @returns {Buffer}
   */
  generateTextSvgBuffer(options = {}, fontFile = null) {
    let fontName = options.font || 'Arial';
    const fontSize = parseInt(options.fontSize, 10) || 48;
    const color = options.color || '#ffffff';
    const outlineColor = options.outlineColor || '#000000';
    const outlineWidth = parseInt(options.outlineWidth, 10) || 0;

    const shadowEnabled = options.shadowEnabled === 'true' || options.shadowEnabled === true;
    const shadowX = parseInt(options.shadowX, 10) || 2;
    const shadowY = parseInt(options.shadowY, 10) || 2;
    const shadowBlur = parseInt(options.shadowBlur, 10) || 2;
    const shadowColor = options.shadowColor || '#000000';

    const text = options.text || 'ToolNest';
    const opacity = parseFloat(options.opacity) !== undefined && !isNaN(parseFloat(options.opacity)) ? parseFloat(options.opacity) : 1.0;
    const padding = parseInt(options.padding, 10) || 0;
    const bgOpacity = parseFloat(options.bgOpacity) !== undefined && !isNaN(parseFloat(options.bgOpacity)) ? parseFloat(options.bgOpacity) : 0;
    const bgColor = options.bgColor || '#000000';

    // Embed custom font file using inline base64 if provided
    let fontFaceStyle = '';
    if (fontFile && fontFile.buffer) {
      const fontBase64 = fontFile.buffer.toString('base64');
      fontName = 'CustomWatermarkFont';
      let mimeType = 'font/ttf';
      if (fontFile.originalname.endsWith('.otf')) mimeType = 'font/otf';
      else if (fontFile.originalname.endsWith('.woff')) mimeType = 'font/woff';
      else if (fontFile.originalname.endsWith('.woff2')) mimeType = 'font/woff2';

      fontFaceStyle = `
        @font-face {
          font-family: '${fontName}';
          src: url(data:${mimeType};charset=utf-8;base64,${fontBase64}) format('truetype');
          font-weight: bold;
          font-style: normal;
        }
      `;
    }

    // Helper to escape XML special characters
    const escapeXml = (unsafe) => {
      return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case '\'': return '&apos;';
          case '"': return '&quot;';
          default: return c;
        }
      });
    };

    // Approximate SVG bounds based on string length and font size
    const charWidth = fontSize * 0.6;
    const w = Math.round(text.length * charWidth + outlineWidth * 2 + Math.abs(shadowX) + shadowBlur * 2 + 40 + padding * 2);
    const h = Math.round(fontSize * 1.4 + outlineWidth * 2 + Math.abs(shadowY) + shadowBlur * 2 + 40 + padding * 2);

    let filterDef = '';
    let filterAttr = '';
    if (shadowEnabled) {
      filterDef = `
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="${shadowX}" dy="${shadowY}" stdDeviation="${shadowBlur}" flood-color="${shadowColor}" />
        </filter>`;
      filterAttr = 'filter="url(#shadow)"';
    }

    // Background plate plate if bgOpacity > 0
    let rectSvg = '';
    if (bgOpacity > 0) {
      const rw = w - 10;
      const rh = h - 10;
      rectSvg = `<rect x="5" y="5" width="${rw}" height="${rh}" fill="${bgColor}" fill-opacity="${bgOpacity * opacity}" rx="8" ry="8" />`;
    }

    const svg = `
      <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          ${filterDef}
          <style>
            ${fontFaceStyle}
            text {
              font-family: '${fontName}', sans-serif;
            }
          </style>
        </defs>
        ${rectSvg}
        <text
          x="50%"
          y="50%"
          text-anchor="middle"
          dominant-baseline="central"
          font-family="${fontName}"
          font-size="${fontSize}px"
          font-weight="bold"
          fill="${color}"
          fill-opacity="${opacity}"
          ${outlineWidth > 0 ? `stroke="${outlineColor}" stroke-opacity="${opacity}" stroke-width="${outlineWidth}"` : ''}
          ${filterAttr}
        >${escapeXml(text)}</text>
      </svg>
    `;

    return Buffer.from(svg);
  }

  /**
   * Applies watermark to image buffer using Sharp composite
   * @param {Object} file - Express Multer file (base image)
   * @param {Object} watermark - Express Multer file (watermark image/svg) or null if text watermark
   * @param {Object} options - Position, opacity, rotation, scale, watermarkType, text configs
   * @param {Object} [fontFile] - Optional custom font file uploaded
   * @returns {Promise<Buffer>} - Watermarked image buffer
   */
  async watermark(file, watermark, options = {}, fontFile = null) {
    if (!file || !file.buffer) {
      throw new Error('No base image file buffer provided for watermarking.');
    }

    // Clear cache to prevent memory footprint issues
    sharp.cache(false);

    const watermarkType = options.watermarkType || 'text';
    const opacity = parseFloat(options.opacity) !== undefined && !isNaN(parseFloat(options.opacity)) ? parseFloat(options.opacity) : 0.7;
    const rotation = parseInt(options.rotation, 10) || 0;
    const scale = parseFloat(options.scale) || 0.3; // Default: 30% of base image width
    const positionType = options.positionType || 'center';
    const customX = parseInt(options.customX, 10) || 0;
    const customY = parseInt(options.customY, 10) || 0;
    const margin = parseInt(options.margin, 10) || 20;
    const blendMode = options.blendMode || 'over';

    // Load base image metadata
    const basePipeline = sharp(file.buffer);
    const baseMeta = await basePipeline.metadata();
    const baseW = baseMeta.width;
    const baseH = baseMeta.height;

    // Get watermark buffer
    let wmBuffer;
    if (watermarkType === 'text') {
      wmBuffer = this.generateTextSvgBuffer(options, fontFile);
    } else if (watermarkType === 'svg') {
      if (!watermark || !watermark.buffer) {
        throw new Error('No SVG watermark file buffer provided.');
      }
      wmBuffer = watermark.buffer;
    } else {
      if (!watermark || !watermark.buffer) {
        throw new Error('No watermark image file buffer provided.');
      }
      wmBuffer = watermark.buffer;
    }

    // Process watermark image
    let wmPipeline = sharp(wmBuffer);
    let wmMeta = await wmPipeline.metadata();

    // 1. Scale watermark based on base image width
    const targetW = Math.max(10, Math.round(baseW * scale));
    const targetH = Math.max(10, Math.round(wmMeta.height * (targetW / wmMeta.width)));

    wmPipeline = wmPipeline.resize({ width: targetW });

    // 2. Adjust opacity on the watermark image using destination-in masking (only for image / svg uploads)
    if (watermarkType !== 'text') {
      const alphaVal = Math.round(opacity * 255);
      const semiTransparentMask = Buffer.from([0, 0, 0, alphaVal]);
      wmPipeline = wmPipeline.ensureAlpha().composite([{
        input: semiTransparentMask,
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in'
      }]);
    }

    // 3. Apply rotation
    if (rotation !== 0) {
      wmPipeline = wmPipeline.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    }

    const processedWmBuffer = await wmPipeline.toBuffer();

    // Get processed watermark metadata to calculate exact coordinates
    const processedWmMeta = await sharp(processedWmBuffer).metadata();
    const wmW = processedWmMeta.width;
    const wmH = processedWmMeta.height;

    // 4. Calculate coordinates
    let left = 0;
    let top = 0;
    let tile = false;

    if (positionType === 'tile') {
      tile = true;
    } else if (positionType === 'top-left') {
      left = margin;
      top = margin;
    } else if (positionType === 'top-right') {
      left = baseW - wmW - margin;
      top = margin;
    } else if (positionType === 'bottom-left') {
      left = margin;
      top = baseH - wmH - margin;
    } else if (positionType === 'bottom-right') {
      left = baseW - wmW - margin;
      top = baseH - wmH - margin;
    } else if (positionType === 'custom') {
      left = customX - Math.round(wmW / 2);
      top = customY - Math.round(wmH / 2);
    } else {
      // Default: Center
      left = Math.round((baseW - wmW) / 2);
      top = Math.round((baseH - wmH) / 2);
    }

    const composition = {
      input: processedWmBuffer,
      blend: blendMode
    };

    if (tile) {
      composition.tile = true;
    } else {
      composition.left = Math.max(0, left);
      composition.top = Math.max(0, top);
    }

    // Composite and output
    const outputBuffer = await sharp(file.buffer)
      .composite([composition])
      .toBuffer();

    return outputBuffer;
  }

  /**
   * Removes background from image buffer
   * @param {Object} file - Express Multer file
   * @param {Object} options - edgeSmoothing, autoCrop switches
   * @returns {Promise<Buffer>}
   */
  async removeBackground(file, options = {}) {
    if (!file || !file.buffer) {
      throw new Error('No base image file buffer provided for background removal.');
    }

    // Force memory garbage collection for sharp caches
    sharp.cache(false);

    const edgeSmoothing = options.edgeSmoothing === 'true' || options.edgeSmoothing === true;
    const autoCrop = options.autoCrop === 'true' || options.autoCrop === true;

    // Cache lookup using buffer SHA-256 hash
    const cacheKey = this._getCacheKey(file.buffer) + `_s:${edgeSmoothing}_c:${autoCrop}`;
    if (this.removeBgCache.has(cacheKey)) {
      console.log('[removeBackground] Cache hit. Serving precompiled background removal.');
      return this.removeBgCache.get(cacheKey);
    }

    let pipeline;
    let processed = false;

    // 1. Real AI removal via remove.bg API with retry loops & backoff
    if (process.env.REMOVEBG_API_KEY) {
      const axios = require('axios');
      const FormData = require('form-data');
      const maxRetries = 3;
      let attempt = 0;

      while (attempt < maxRetries && !processed) {
        try {
          attempt++;
          const form = new FormData();
          form.append('image_file', file.buffer, { filename: 'image.png' });
          form.append('size', 'auto');

          let response = await axios.post('https://api.remove.bg/v1.0/removebg', form, {
            headers: { ...form.getHeaders(), 'X-Api-Key': process.env.REMOVEBG_API_KEY },
            responseType: 'arraybuffer',
            timeout: 15000,
            validateStatus: () => true
          });

          // Credits failure fallback logic
          if (response.status !== 200) {
            const errMsg = Buffer.from(response.data).toString();
            if (response.status === 402 || errMsg.includes('credits') || errMsg.includes('payment')) {
              console.warn('[remove.bg] Insufficient credits. Retrying with free size=preview...');
              const previewForm = new FormData();
              previewForm.append('image_file', file.buffer, { filename: 'image.png' });
              previewForm.append('size', 'preview');

              response = await axios.post('https://api.remove.bg/v1.0/removebg', previewForm, {
                headers: { ...previewForm.getHeaders(), 'X-Api-Key': process.env.REMOVEBG_API_KEY },
                responseType: 'arraybuffer',
                timeout: 10000,
                validateStatus: () => true
              });
            }
          }

          if (response.status === 200) {
            pipeline = sharp(Buffer.from(response.data));
            processed = true;
          } else {
            throw new Error(`API Status ${response.status}: ${Buffer.from(response.data).toString()}`);
          }
        } catch (err) {
          console.warn(`[remove.bg API Attempt ${attempt} Fail]`, err.message);
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 500; // 1s, 2s
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }
    }

    // 2. Fallback to worker-threaded flood-fill connected border keying
    if (!processed) {
      console.log('[removeBackground] Falling back to worker thread connected boundary keying...');
      try {
        const { data, info } = await sharp(file.buffer).raw().toBuffer({ resolveWithObject: true });
        const { width, height, channels } = info;

        // Delegate CPU bound heavy operations to background Worker thread
        const outBuffer = await this.runRemoveBgWorker(data, width, height, channels);

        const pngBuffer = await sharp(outBuffer, { raw: { width, height, channels: 4 } }).png().toBuffer();
        pipeline = sharp(pngBuffer);
        processed = true;
      } catch (workerErr) {
        console.error('[Worker fallback crashed, using main-thread safety backup]', workerErr.message);
        
        // Final synchronous safety backup thresholding on main thread
        const { data, info } = await sharp(file.buffer).raw().toBuffer({ resolveWithObject: true });
        const { width, height, channels } = info;

        const getPixel = (x, y) => {
          const idx = (y * width + x) * channels;
          return {
            r: data[idx],
            g: data[idx + 1],
            b: data[idx + 2],
            a: channels === 4 ? data[idx + 3] : 255
          };
        };

        const corners = [
          getPixel(0, 0),
          getPixel(width - 1, 0),
          getPixel(0, height - 1),
          getPixel(width - 1, height - 1)
        ];

        let bgR = 0, bgG = 0, bgB = 0, count = 0;
        corners.forEach(p => {
          if (p.a > 128) {
            bgR += p.r;
            bgG += p.g;
            bgB += p.b;
            count++;
          }
        });

        if (count > 0) {
          bgR = Math.round(bgR / count);
          bgG = Math.round(bgG / count);
          bgB = Math.round(bgB / count);
        } else {
          bgR = 255; bgG = 255; bgB = 255;
        }

        const outBuffer = Buffer.alloc(width * height * 4);
        const threshold = 35;
        for (let i = 0; i < width * height; i++) {
          const srcIdx = i * channels;
          const dstIdx = i * 4;
          const r = data[srcIdx];
          const g = data[srcIdx + 1];
          const b = data[srcIdx + 2];
          const a = channels === 4 ? data[srcIdx + 3] : 255;

          const dist = Math.sqrt(Math.pow(r - bgR, 2) + Math.pow(g - bgG, 2) + Math.pow(b - bgB, 2));
          outBuffer[dstIdx] = r;
          outBuffer[dstIdx + 1] = g;
          outBuffer[dstIdx + 2] = b;
          if (dist < threshold) {
            outBuffer[dstIdx] = 0;
            outBuffer[dstIdx + 1] = 0;
            outBuffer[dstIdx + 2] = 0;
            outBuffer[dstIdx + 3] = 0;
          } else {
            outBuffer[dstIdx + 3] = a;
          }
        }
        const pngBuffer = await sharp(outBuffer, { raw: { width, height, channels: 4 } }).png().toBuffer();
        pipeline = sharp(pngBuffer);
      }
    }

    // 3. Post-Processing: Edge Smoothing (Feathering)
    if (edgeSmoothing) {
      const rawBuffer = await pipeline.toBuffer();
      const alphaPng = await sharp(rawBuffer)
        .extractChannel('alpha')
        .blur(1.2)
        .png()
        .toBuffer();

      const compositedBuffer = await sharp(rawBuffer)
        .composite([{
          input: alphaPng,
          blend: 'dest-in'
        }])
        .png()
        .toBuffer();

      pipeline = sharp(compositedBuffer);
    }

    // 4. Transparent PNG Footprint Compression (Optimization)
    // Ensures all fully transparent pixels have R, G, B set to 0.
    // Extremely effective for PNG gzip compression efficiency.
    const pretrimmedBuffer = await pipeline.toBuffer();
    const { data: optPixels, info: optInfo } = await sharp(pretrimmedBuffer).raw().toBuffer({ resolveWithObject: true });
    
    for (let i = 0; i < optInfo.width * optInfo.height; i++) {
      const idx = i * 4;
      if (optPixels[idx + 3] === 0) {
        optPixels[idx] = 0;
        optPixels[idx + 1] = 0;
        optPixels[idx + 2] = 0;
      }
    }
    
    pipeline = sharp(optPixels, { raw: { width: optInfo.width, height: optInfo.height, channels: 4 } });

    // 5. Post-Processing: Auto Crop Transparent Borders
    if (autoCrop) {
      pipeline = pipeline.trim();
    }

    const finalPngBuffer = await pipeline.png().toBuffer();

    // Cache the output PNG
    this._setCache(cacheKey, finalPngBuffer);

    return finalPngBuffer;
  }

  /**
   * Helper to detect hardware accelerated graphics controller
   * @returns {Promise<boolean>}
   */
  detectGpuSupport() {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const platform = process.platform;
      if (platform === 'win32') {
        exec('wmic path win32_VideoController get name', (err, stdout) => {
          if (err || !stdout) return resolve(false);
          const lower = stdout.toLowerCase();
          const hasGpu = lower.includes('nvidia') || lower.includes('amd') || lower.includes('geforce') || lower.includes('radeon') || lower.includes('quadro');
          resolve(hasGpu);
        });
      } else if (platform === 'linux') {
        exec('lspci | grep -i -E "vga|3d|display"', (err, stdout) => {
          if (err || !stdout) return resolve(false);
          const lower = stdout.toLowerCase();
          const hasGpu = lower.includes('nvidia') || lower.includes('amd') || lower.includes('radeon');
          resolve(hasGpu);
        });
      } else if (platform === 'darwin') {
        exec('system_profiler SPDisplaysDataType', (err, stdout) => {
          if (err || !stdout) return resolve(false);
          const lower = stdout.toLowerCase();
          const hasGpu = lower.includes('nvidia') || lower.includes('amd') || lower.includes('radeon') || lower.includes('apple');
          resolve(hasGpu);
        });
      } else {
        resolve(false);
      }
    });
  }

  /**
   * Upscales image buffer using AI/high-fidelity algorithms
   * @param {Object} file - Express Multer file
   * @param {Object} options - scale, noiseReduction, sharpen, faceEnhancement
   * @returns {Promise<Buffer>}
   */
  async aiUpscale(file, options = {}) {
    if (!file || !file.buffer) {
      throw new Error('No image file buffer provided for upscaling.');
    }

    // Force clear Sharp cache
    sharp.cache(false);

    // Read dimensions
    const metadata = await sharp(file.buffer).metadata();
    const width = metadata.width;
    const height = metadata.height;

    // Megapixel safety limits to prevent memory exhaustion
    if (width * height > 4000000) {
      throw new Error('Input image is too large for upscaling. Please limit to under 4 megapixels (e.g. 2000x2000px).');
    }

    // Parse parameters
    const scaleStr = options.scale || '2x';
    const scaleFactor = scaleStr === '8x' ? 8 : (scaleStr === '4x' ? 4 : 2);
    const noiseReduction = options.noiseReduction || 'off';
    const sharpen = options.sharpen || 'off';
    const faceEnhancement = options.faceEnhancement === 'true' || options.faceEnhancement === true;

    // Calculate target dimensions
    const targetW = Math.round(width * scaleFactor);
    const targetH = Math.round(height * scaleFactor);

    // GPU Hardware Acceleration Concurrency Optimizations
    try {
      const hasGpu = await this.detectGpuSupport();
      const os = require('os');
      if (hasGpu) {
        console.log('[GPU Detection] Hardware-accelerated GPU found. Maximizing CPU thread pool concurrency.');
        sharp.concurrency(Math.max(4, os.cpus().length));
      } else {
        console.log('[GPU Detection] No GPU acceleration detected. Allocating moderate worker threads.');
        sharp.concurrency(Math.min(4, os.cpus().length));
      }
    } catch (concurrencyErr) {
      console.warn('[GPU Tuning Warning] Concurrency mapping error.', concurrencyErr.message);
    }

    try {
      // 1. High-fidelity resampling using Lanczos3 kernel (Crisp high-frequency edges)
      const lanczosBuffer = await sharp(file.buffer)
        .resize(targetW, targetH, {
          kernel: 'lanczos3',
          fastShrinkOnLoad: false
        })
        .toBuffer();

      let finalPipeline = sharp(lanczosBuffer);

      // 2. Hybrid Blending (Bicubic Overlay at 35% opacity to suppress contrast halo artifacts)
      if (scaleFactor > 2) {
        const bicubicBuffer = await sharp(file.buffer)
          .resize(targetW, targetH, {
            kernel: 'cubic',
            fastShrinkOnLoad: false
          })
          .toBuffer();

        const alphaMaskVal = Math.round(0.35 * 255);
        const semiTransparentBicubic = await sharp(bicubicBuffer)
          .ensureAlpha()
          .composite([{
            input: Buffer.from([0, 0, 0, alphaMaskVal]),
            raw: { width: 1, height: 1, channels: 4 },
            tile: true,
            blend: 'dest-in'
          }])
          .toBuffer();

        finalPipeline = finalPipeline.composite([{
          input: semiTransparentBicubic,
          blend: 'over'
        }]);
      }

      // Convert pipeline back to dynamic sharp element for post filters
      const compositedBuffer = await finalPipeline.toBuffer();
      let pipeline = sharp(compositedBuffer);

      // 3. Adaptive Noise Reduction (Median / Blur filter combinations)
      if (noiseReduction === 'low') {
        pipeline = pipeline.median(3);
      } else if (noiseReduction === 'medium') {
        pipeline = pipeline.median(3).blur(0.5);
      } else if (noiseReduction === 'high') {
        pipeline = pipeline.median(5).blur(1.0);
      }

      // 4. Face Enhancement details smoothing
      if (faceEnhancement) {
        pipeline = pipeline.median(3).sharpen({ sigma: 0.8, m1: 1.5, m2: 3.5 });
      }

      // 5. Sharpening filter (Unsharp masking)
      if (sharpen === 'low') {
        pipeline = pipeline.sharpen({ sigma: 0.5, m1: 1.0, m2: 2.0 });
      } else if (sharpen === 'medium') {
        pipeline = pipeline.sharpen({ sigma: 1.0, m1: 2.0, m2: 4.0 });
      } else if (sharpen === 'high') {
        pipeline = pipeline.sharpen({ sigma: 1.5, m1: 3.0, m2: 6.0 });
      }

      return await pipeline.toBuffer();
    } catch (err) {
      console.error('[AI Upscale Premium Pipeline Failed] Falling back to standard bicubic resampling...', err.message);
      // Safe Step-down Bicubic Fallback on Main thread
      return await sharp(file.buffer)
        .resize(targetW, targetH, { kernel: 'cubic' })
        .sharpen()
        .toBuffer();
    }
  }

  /**
   * Extracts metadata from image buffer using sharp and exifreader
   * @param {Object} file - Express Multer file
   * @returns {Promise<Object>}
   */
  async getMetadata(file) {
    if (!file || !file.buffer) {
      throw new Error('No image file buffer provided for metadata extraction.');
    }

    const sharpMeta = await sharp(file.buffer).metadata();

    const result = {
      dimensions: `${sharpMeta.width || 0} x ${sharpMeta.height || 0} px`,
      dpi: sharpMeta.density ? `${sharpMeta.density} DPI` : '72 DPI',
      bitDepth: sharpMeta.depth ? `${sharpMeta.depth * (sharpMeta.bits || 8)} bits` : '8 bits',
      colorProfile: sharpMeta.space || 'sRGB',
      camera: 'N/A',
      gps: 'N/A',
      iso: 'N/A',
      lens: 'N/A',
      date: 'N/A',
      exifTags: {}
    };

    try {
      const ExifReader = require('exifreader');
      const tags = ExifReader.load(file.buffer);

      if (tags['Model'] || tags['Make']) {
        const make = tags['Make']?.description || '';
        const model = tags['Model']?.description || '';
        result.camera = `${make} ${model}`.trim();
      }

      if (tags['GPSLatitude'] && tags['GPSLongitude']) {
        const lat = tags['GPSLatitude'].description;
        const lon = tags['GPSLongitude'].description;
        result.gps = `Lat: ${parseFloat(lat).toFixed(6)}, Lon: ${parseFloat(lon).toFixed(6)}`;
      }

      if (tags['ISOSpeedRatings'] || tags['ISO']) {
        result.iso = tags['ISOSpeedRatings']?.description || tags['ISO']?.description || 'N/A';
      }

      if (tags['LensModel'] || tags['LensInfo']) {
        result.lens = tags['LensModel']?.description || tags['LensInfo']?.description || 'N/A';
      }

      if (tags['DateTimeOriginal'] || tags['DateTime']) {
        result.date = tags['DateTimeOriginal']?.description || tags['DateTime']?.description || 'N/A';
      }

      const details = {};
      for (const [key, value] of Object.entries(tags)) {
        if (value && typeof value.description === 'string') {
          details[key] = value.description;
        }
      }
      result.exifTags = details;
    } catch (err) {
      console.warn('[ExifReader Fail] Could not parse EXIF details.', err.message);
    }

    return result;
  }

  /**
   * Removes metadata from image buffer
   * @param {Object} file - Express Multer file
   * @returns {Promise<Buffer>}
   */
  async removeMetadata(file) {
    if (!file || !file.buffer) {
      throw new Error('No image file buffer provided for metadata removal.');
    }

    const pipeline = sharp(file.buffer);
    if (typeof pipeline.keepMetadata === 'function') {
      return await pipeline.keepMetadata(false).toBuffer();
    }
    return await pipeline.toBuffer();
  }
}

module.exports = new ImageService();