/**
 * @jest-environment node
 *
 * scripts/lib/bmp.js: 24-bit uncompressed BMP for the NSIS installer art.
 * The header is parsed here by offset, independently of the writer.
 */
import { encodeBmp, rowStride } from '../../../scripts/lib/bmp';

/** A 3 x 2 RGB image, top-down: red, green, blue / white, black, grey. */
const FIXTURE = {
  width: 3,
  height: 2,
  channels: 3 as const,
  data: Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 128, 128, 128]),
};

describe('encodeBmp', () => {
  const bmp = encodeBmp(FIXTURE);

  it('writes a BITMAPFILEHEADER and a 40-byte BITMAPINFOHEADER for 24-bit BI_RGB', () => {
    expect(bmp.toString('ascii', 0, 2)).toBe('BM');
    expect(bmp.readUInt32LE(2)).toBe(bmp.length); // file size
    expect(bmp.readUInt32LE(6)).toBe(0); // reserved
    expect(bmp.readUInt32LE(10)).toBe(54); // pixel data offset
    expect(bmp.readUInt32LE(14)).toBe(40); // info header size
    expect(bmp.readInt32LE(18)).toBe(3); // width
    expect(bmp.readInt32LE(22)).toBe(2); // positive height: bottom-up rows
    expect(bmp.readUInt16LE(26)).toBe(1); // planes
    expect(bmp.readUInt16LE(28)).toBe(24); // bits per pixel
    expect(bmp.readUInt32LE(30)).toBe(0); // BI_RGB, uncompressed
    expect(bmp.readUInt32LE(34)).toBe(12 * 2); // image size: padded rows
  });

  it('pads each row to a multiple of 4 bytes (3 px x 3 bytes = 9, padded to 12)', () => {
    expect(rowStride(3)).toBe(12);
    expect(rowStride(150)).toBe(452);
    expect(rowStride(164)).toBe(492);
    expect(bmp.length).toBe(54 + 12 * 2);
    // The three padding bytes of each row are zero.
    expect([...bmp.subarray(54 + 9, 54 + 12)]).toEqual([0, 0, 0]);
    expect([...bmp.subarray(54 + 21, 54 + 24)]).toEqual([0, 0, 0]);
  });

  it('stores rows bottom-up, each pixel in B, G, R order', () => {
    const firstStoredRow = [...bmp.subarray(54, 54 + 9)];
    const secondStoredRow = [...bmp.subarray(54 + 12, 54 + 21)];
    // The bottom image row (white, black, grey) comes first.
    expect(firstStoredRow).toEqual([255, 255, 255, 0, 0, 0, 128, 128, 128]);
    // Then the top row: red, green, blue written as BGR.
    expect(secondStoredRow).toEqual([0, 0, 255, 0, 255, 0, 255, 0, 0]);
  });

  it('flattens alpha onto the background, since a 24-bit BMP has none', () => {
    const rgba = {
      width: 2,
      height: 1,
      channels: 4 as const,
      // Opaque blue, then fully transparent red.
      data: Buffer.from([0, 0, 255, 255, 255, 0, 0, 0]),
    };
    const sand = [250, 247, 242] as [number, number, number];
    const out = encodeBmp(rgba, sand);
    expect(out.readUInt16LE(28)).toBe(24);
    expect([...out.subarray(54, 60)]).toEqual([255, 0, 0, 242, 247, 250]);
  });

  it('blends half-transparent pixels', () => {
    const out = encodeBmp(
      { width: 1, height: 1, channels: 4, data: Buffer.from([0, 0, 0, 128]) },
      [255, 255, 255]
    );
    expect([...out.subarray(54, 57)]).toEqual([127, 127, 127]);
  });

  it('rejects pixel data that does not match the stated size', () => {
    expect(() => encodeBmp({ ...FIXTURE, data: Buffer.alloc(5) })).toThrow(/expected 18/);
    expect(() =>
      encodeBmp({ ...FIXTURE, channels: 2 as unknown as 3, data: Buffer.alloc(12) })
    ).toThrow(/3 or 4 channels/);
    expect(() => encodeBmp({ ...FIXTURE, width: 0 })).toThrow(/Invalid BMP size/);
  });
});
