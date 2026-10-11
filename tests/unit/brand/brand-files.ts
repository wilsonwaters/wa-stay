/** Paths shared by the brand asset tests (B1). */
import fs from 'fs';
import path from 'path';

export const ROOT = path.resolve(__dirname, '../../..');
export const BRAND_DIR = path.join(ROOT, 'resources/brand');
export const CONCEPTS_DIR = path.join(BRAND_DIR, 'concepts');
export const ICONS_DIR = path.join(ROOT, 'resources/icons');
export const RENDERER_BRAND_DIR = path.join(ROOT, 'src/renderer/assets/brand');
export const TOKENS_CSS = path.join(ROOT, 'src/renderer/styles/tokens.css');

/** The six brand SVGs from B1 Scope 1. */
export const BRAND_SVGS = [
  'wa-stay-mark.svg',
  'wa-stay-mark-small.svg',
  'wa-stay-lockup.svg',
  'wa-stay-mark-mono.svg',
  'wa-stay-lockup-mono.svg',
  'readme-banner.svg',
] as const;

export const MONO_SVGS = ['wa-stay-mark-mono.svg', 'wa-stay-lockup-mono.svg'];

export const isMono = (file: string) => /-mono\.svg$/.test(file);

/** Every brand SVG on disk: the brand set, the concept review set and the renderer copies. */
export function allBrandSvgFiles(): string[] {
  const list = (dir: string) =>
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.svg'))
      .map((f) => path.join(dir, f));
  return [...list(BRAND_DIR), ...list(CONCEPTS_DIR), ...list(RENDERER_BRAND_DIR)];
}

export const read = (file: string) => fs.readFileSync(file, 'utf8');
export const rel = (file: string) => path.relative(ROOT, file);
