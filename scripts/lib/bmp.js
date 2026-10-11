'use strict';

/**
 * Minimal BMP writer for the NSIS installer art: 24-bit, uncompressed (BI_RGB), with a
 * 40-byte BITMAPINFOHEADER. NSIS loads MUI_HEADERIMAGE_BITMAP and MUI_WELCOMEFINISHPAGE_BITMAP
 * as bitmaps only, and sharp cannot write BMP, so generate-icons.js renders with
 * `sharp(...).raw()` and hands the pixels to `encodeBmp`.
 *
 * Layout: rows are stored bottom-up (positive height), each pixel as B, G, R, and every row is
 * padded with zero bytes to a multiple of 4 (150 px x 3 bytes = 450, padded to 452).
 * BMP has no alpha here, so 4-channel input is composited onto `background` first.
 */

const FILE_HEADER = 14;
const INFO_HEADER = 40;
const PIXELS_PER_METRE = 2835; // 72 dpi

/** Bytes per stored row: 3 bytes per pixel, padded to a multiple of 4. */
const rowStride = (width) => Math.ceil((width * 3) / 4) * 4;

/**
 * @param {{ data: Buffer | Uint8Array, width: number, height: number, channels: 3 | 4 }} image
 *   Top-down RGB or RGBA pixels, as `sharp(...).raw().toBuffer({ resolveWithObject: true })`
 *   gives them (pass `info.channels`).
 * @param {[number, number, number]} [background] RGB to flatten alpha onto. White by default.
 * @returns {Buffer} The complete .bmp file.
 */
function encodeBmp({ data, width, height, channels }, background = [255, 255, 255]) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`Invalid BMP size ${width}x${height}`);
  }
  if (channels !== 3 && channels !== 4) {
    throw new Error(`BMP input must have 3 or 4 channels, got ${channels}`);
  }
  if (data.length !== width * height * channels) {
    throw new Error(
      `BMP input has ${data.length} bytes, expected ${width * height * channels} (${width}x${height}x${channels})`
    );
  }

  const stride = rowStride(width);
  const imageSize = stride * height;
  const offset = FILE_HEADER + INFO_HEADER;
  const out = Buffer.alloc(offset + imageSize); // zero-filled, so row padding is already 0

  // BITMAPFILEHEADER
  out.write('BM', 0, 'ascii');
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(0, 6); // two reserved WORDs
  out.writeUInt32LE(offset, 10);

  // BITMAPINFOHEADER
  out.writeUInt32LE(INFO_HEADER, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22); // positive: rows run bottom-up
  out.writeUInt16LE(1, 26); // colour planes
  out.writeUInt16LE(24, 28); // bits per pixel
  out.writeUInt32LE(0, 30); // BI_RGB, no compression
  out.writeUInt32LE(imageSize, 34);
  out.writeInt32LE(PIXELS_PER_METRE, 38);
  out.writeInt32LE(PIXELS_PER_METRE, 42);
  out.writeUInt32LE(0, 46); // colours in the palette: none
  out.writeUInt32LE(0, 50); // important colours: all

  const [br, bg, bb] = background;
  for (let y = 0; y < height; y++) {
    const rowStart = offset + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];
      if (channels === 4) {
        const a = data[i + 3] / 255;
        r = Math.round(r * a + br * (1 - a));
        g = Math.round(g * a + bg * (1 - a));
        b = Math.round(b * a + bb * (1 - a));
      }
      const o = rowStart + x * 3;
      out[o] = b;
      out[o + 1] = g;
      out[o + 2] = r;
    }
  }
  return out;
}

module.exports = { encodeBmp, rowStride };
