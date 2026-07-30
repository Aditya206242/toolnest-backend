const { parentPort, workerData } = require('worker_threads');

try {
  const { pixelBuffer, width, height, channels } = workerData;
  const data = Buffer.from(pixelBuffer);
  
  // Average background color sampling from corners
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
  const visited = new Uint8Array(width * height);
  
  // Preallocated queue for coordinates (x, y) to keep memory footprint minimal
  const queue = new Int32Array(width * height * 2);
  let head = 0;
  let tail = 0;

  const pushQueue = (x, y) => {
    const idx = y * width + x;
    if (visited[idx]) return;
    visited[idx] = 1;
    queue[tail * 2] = x;
    queue[tail * 2 + 1] = y;
    tail++;
  };

  // Push all boundary pixels as seed points
  for (let x = 0; x < width; x++) {
    pushQueue(x, 0);
    pushQueue(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    pushQueue(0, y);
    pushQueue(width - 1, y);
  }

  const threshold = 35;
  const tolerance = 12;
  const lowerThreshold = threshold - tolerance;
  const upperThreshold = threshold + tolerance;

  // Initialize output buffer with subject pixels
  for (let i = 0; i < width * height; i++) {
    const srcIdx = i * channels;
    const dstIdx = i * 4;
    outBuffer[dstIdx] = data[srcIdx];
    outBuffer[dstIdx + 1] = data[srcIdx + 1];
    outBuffer[dstIdx + 2] = data[srcIdx + 2];
    outBuffer[dstIdx + 3] = channels === 4 ? data[srcIdx + 3] : 255;
  }

  // Flood fill connected background colors
  while (head < tail) {
    const x = queue[head * 2];
    const y = queue[head * 2 + 1];
    head++;

    const idx = y * width + x;
    const srcIdx = idx * channels;
    const dstIdx = idx * 4;

    const r = data[srcIdx];
    const g = data[srcIdx + 1];
    const b = data[srcIdx + 2];
    const a = channels === 4 ? data[srcIdx + 3] : 255;

    // Euclidean color distance between pixel and average background color
    const dist = Math.sqrt(
      Math.pow(r - bgR, 2) +
      Math.pow(g - bgG, 2) +
      Math.pow(b - bgB, 2)
    );

    if (dist < lowerThreshold) {
      // Background matched: fully transparent
      outBuffer[dstIdx] = 0;
      outBuffer[dstIdx + 1] = 0;
      outBuffer[dstIdx + 2] = 0;
      outBuffer[dstIdx + 3] = 0;

      // Expand queue to adjacent neighbors
      if (x + 1 < width) pushQueue(x + 1, y);
      if (x - 1 >= 0) pushQueue(x - 1, y);
      if (y + 1 < height) pushQueue(x, y + 1);
      if (y - 1 >= 0) pushQueue(x, y - 1);
    } else if (dist < upperThreshold) {
      // Transition range: interpolate transparency alpha
      const factor = (dist - lowerThreshold) / (tolerance * 2);
      const targetAlpha = Math.round(factor * a);
      outBuffer[dstIdx + 3] = targetAlpha;

      if (targetAlpha === 0) {
        outBuffer[dstIdx] = 0;
        outBuffer[dstIdx + 1] = 0;
        outBuffer[dstIdx + 2] = 0;
      }
      // Do NOT push neighbors for transitions; it acts as subject edge boundary
    } else {
      // Solid subject block: keep original colors, do not expand
    }
  }

  parentPort.postMessage({ status: 'success', buffer: outBuffer });
} catch (err) {
  parentPort.postMessage({ status: 'error', error: err.message });
}
