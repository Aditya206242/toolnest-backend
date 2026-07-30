/**
 * Verifies if a buffer begins with the standard PDF header bytes (%PDF-)
 * @param {Buffer} buffer - File buffer
 * @returns {boolean}
 */
const isValidPdfBuffer = (buffer) => {
  if (!buffer || buffer.length < 5) return false;
  
  // Read first 5 bytes and convert to ASCII
  const header = buffer.toString('ascii', 0, 5);
  return header === '%PDF-';
};

module.exports = {
  isValidPdfBuffer,
};
