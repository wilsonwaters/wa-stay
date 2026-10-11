/**
 * @jest-environment node
 *
 * The committed rasters from `npm run icons`: Windows ICO, the PNG set, the NSIS bitmaps and
 * the renderer copies. Headers are parsed by offset here, independently of the writers.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { BRAND_DIR, ICONS_DIR, RENDERER_BRAND_DIR, ROOT } from './brand-files';

const icon = (name: string) => path.join(ICONS_DIR, name);

interface IcoEntry {
  width: number;
  height: number;
  bitsPerPixel: number;
  size: number;
  offset: number;
}

function readIcoDirectory(buf: Buffer): { type: number; entries: IcoEntry[] } {
  const count = buf.readUInt16LE(4);
  const entries: IcoEntry[] = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    entries.push({
      width: buf.readUInt8(at) || 256, // 0 means 256
      height: buf.readUInt8(at + 1) || 256,
      bitsPerPixel: buf.readUInt16LE(at + 6),
      size: buf.readUInt32LE(at + 8),
      offset: buf.readUInt32LE(at + 12),
    });
  }
  return { type: buf.readUInt16LE(2), entries };
}

describe('resources/icons/icon.ico', () => {
  const buf = fs.readFileSync(icon('icon.ico'));
  const { type, entries } = readIcoDirectory(buf);

  it('is an icon file with exactly 7 images: 16, 24, 32, 48, 64, 128, 256', () => {
    expect(buf.readUInt16LE(0)).toBe(0);
    expect(type).toBe(1);
    expect(entries.map((e) => e.width)).toEqual([16, 24, 32, 48, 64, 128, 256]);
    for (const e of entries) expect(e.height).toBe(e.width);
  });

  it('holds 32-bit images whose data lies inside the file and matches the directory', () => {
    for (const e of entries) {
      expect(e.bitsPerPixel).toBe(32);
      expect(e.offset + e.size).toBeLessThanOrEqual(buf.length);
      // Each image is a DIB: a 40-byte BITMAPINFOHEADER with the doubled ICO height.
      expect(buf.readUInt32LE(e.offset)).toBe(40);
      expect(buf.readInt32LE(e.offset + 4)).toBe(e.width);
      expect(buf.readInt32LE(e.offset + 8)).toBe(e.width * 2);
    }
  });

  it('keeps transparent corners, so Windows can draw it on any taskbar', () => {
    const e = entries[entries.length - 1]; // 256 px, stored bottom-up as BGRA
    const pixels = e.offset + 40;
    const alphaAt = (x: number, y: number) => buf[pixels + ((255 - y) * 256 + x) * 4 + 3];
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(255, 255)).toBe(0);
    expect(alphaAt(128, 128)).toBe(255);
  });
});

describe('PNG icon set', () => {
  it('icon.png is 1024 x 1024', async () => {
    const meta = await sharp(icon('icon.png')).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 1024, 1024]);
  });

  it.each([16, 32, 48, 64, 128, 256, 512, 1024])('%ix%i.png has its stated size', async (n) => {
    const meta = await sharp(icon(`${n}x${n}.png`)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', n, n]);
    expect(meta.hasAlpha).toBe(true);
  });

  it('email-logo.png is the small 80 x 80 icon for the emails, not the 1024 one', async () => {
    const meta = await sharp(icon('email-logo.png')).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 80, 80]);
    expect(meta.hasAlpha).toBe(true);
    expect(fs.statSync(icon('email-logo.png')).size).toBeLessThan(10 * 1024);
  });

  it('readme-banner.png is 1280 x 640', async () => {
    const meta = await sharp(path.join(BRAND_DIR, 'readme-banner.png')).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 1280, 640]);
  });
});

describe('NSIS installer bitmaps', () => {
  it.each([
    ['installer-header.bmp', 150, 57, 452],
    ['installer-sidebar.bmp', 164, 314, 492],
  ])('%s is %ix%i, 24-bit BI_RGB, rows padded to %i bytes', (name, width, height, stride) => {
    const buf = fs.readFileSync(icon(name));
    expect(buf.toString('ascii', 0, 2)).toBe('BM');
    expect(buf.readUInt32LE(2)).toBe(buf.length);
    expect(buf.readUInt32LE(14)).toBe(40);
    expect(buf.readInt32LE(18)).toBe(width);
    expect(buf.readInt32LE(22)).toBe(height);
    expect(buf.readUInt16LE(28)).toBe(24);
    expect(buf.readUInt32LE(30)).toBe(0); // BI_RGB
    expect(buf.length).toBe(buf.readUInt32LE(10) + stride * height);
  });

  it('the header is flattened onto white and the sidebar onto sand', () => {
    // Bottom-left pixel is the first one stored, in B, G, R order.
    const corner = (name: string) => {
      const buf = fs.readFileSync(icon(name));
      const at = buf.readUInt32LE(10);
      return [buf[at + 2], buf[at + 1], buf[at]];
    };
    expect(corner('installer-header.bmp')).toEqual([255, 255, 255]);
    expect(corner('installer-sidebar.bmp')).toEqual([250, 247, 242]);
  });

  it('no PNG installer images remain', () => {
    expect(fs.existsSync(icon('installer-header.png'))).toBe(false);
    expect(fs.existsSync(icon('installer-sidebar.png'))).toBe(false);
  });
});

describe('renderer copies', () => {
  it.each([
    ['logo-lockup.svg', 'wa-stay-lockup.svg'],
    ['logo-mark.svg', 'wa-stay-mark.svg'],
    ['logo-mark-mono.svg', 'wa-stay-mark-mono.svg'],
  ])('src/renderer/assets/brand/%s is byte-identical to resources/brand/%s', (copy, source) => {
    const a = fs.readFileSync(path.join(RENDERER_BRAND_DIR, copy));
    const b = fs.readFileSync(path.join(BRAND_DIR, source));
    expect(a.equals(b)).toBe(true);
  });

  it('the contact sheets exist for review', () => {
    expect(fs.existsSync(path.join(ROOT, 'docs/design/brand/contact-sheet.png'))).toBe(true);
    expect(fs.existsSync(path.join(BRAND_DIR, 'concepts/contact-sheet.png'))).toBe(true);
  });
});
