/**
 * The production renderer build carries the CSP: `vite build` (the real config, into a temp
 * folder) writes the production policy as the first element of `<head>`.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildCsp } from '@main/app/csp';

const ROOT = path.resolve(__dirname, '../..');

/** An attribute value as the HTML parser reads it: Vite writes `'` as `&#39;`. */
function decodeAttribute(value: string): string {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (entity, dec, hex, name) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return named[name.toLowerCase()] ?? entity;
  });
}

describe('built renderer index.html', () => {
  let outDir: string;

  beforeAll(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-renderer-'));
    execFileSync(
      process.execPath,
      [
        path.join(ROOT, 'node_modules/vite/bin/vite.js'),
        'build',
        '--outDir',
        outDir,
        '--emptyOutDir',
      ],
      { cwd: ROOT, stdio: 'pipe' }
    );
  }, 180_000);

  afterAll(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('has the production CSP meta as the first child of <head>', () => {
    const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? '';
    const firstElement = /<[a-z][^>]*>/i.exec(head)?.[0] ?? '';
    const meta = /^<meta http-equiv="Content-Security-Policy" content="([^"]*)">$/.exec(
      firstElement
    );

    expect(meta).not.toBeNull();
    expect(decodeAttribute(meta?.[1] ?? '')).toBe(buildCsp({ dev: false }));
    // Exactly one policy, and no inline scripts for it to allow
    expect(html.match(/Content-Security-Policy/g)).toHaveLength(1);
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
  });
});
