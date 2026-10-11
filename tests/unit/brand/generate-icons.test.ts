/**
 * @jest-environment node
 *
 * scripts/generate-icons.js stops with the file name when a source SVG is missing or broken.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  EMAIL_LOGO_SIZE,
  ICO_SIZES,
  PNG_SIZES,
  checkXml,
  readSvg,
} from '../../../scripts/generate-icons';

describe('generate-icons source checks', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay icons '));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('names a missing source SVG', async () => {
    const file = path.join(dir, 'wa-stay-mark.svg');
    await expect(readSvg(file)).rejects.toThrow(/^Missing source SVG: .*wa-stay-mark\.svg$/);
  });

  it('names a source SVG that is not well-formed XML', async () => {
    const file = path.join(dir, 'broken.svg');
    fs.writeFileSync(
      file,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><path d="M0 0Z">'
    );
    await expect(readSvg(file)).rejects.toThrow(
      /^Invalid SVG .*broken\.svg: <path> is never closed/
    );
  });

  it('reads a valid SVG from a path with spaces', async () => {
    const file = path.join(dir, 'ok mark.svg');
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><path d="M0 0H2V2Z"/></svg>';
    fs.writeFileSync(file, svg);
    await expect(readSvg(file)).resolves.toBe(svg);
  });

  it.each([
    ['<svg><g></svg>', /<\/svg> closes <g>/],
    ['<svg><path d="M0 0Z"/></svg><svg/>', /content after <\/svg>/],
    ['<svg><path d=M0/></svg>', /malformed tag/],
    ['<path/>', /does not start with <svg/],
  ])('checkXml rejects %s', (svg, message) => {
    expect(() => checkXml(svg)).toThrow(message);
  });

  it('builds the icon sizes the spec lists', () => {
    expect(ICO_SIZES).toEqual([16, 24, 32, 48, 64, 128, 256]);
    expect(PNG_SIZES).toEqual([16, 32, 48, 64, 128, 256, 512, 1024]);
    // The emails show the logo at 40 px: 2x
    expect(EMAIL_LOGO_SIZE).toBe(80);
  });
});
