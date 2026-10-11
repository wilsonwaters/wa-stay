/**
 * @jest-environment node
 *
 * The website in site/ (published to GitHub Pages by .github/workflows/pages.yml):
 * every local link, image and stylesheet resolves; every image has alt text and a size; in-page
 * anchors exist; nothing loads from another site; the colours are the app's tokens; and the
 * fonts, logo and brushstrokes are the app's own files, unchanged.
 */

import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(__dirname, '../../..');
const SITE = path.join(ROOT, 'site');
const PAGES = fs.readdirSync(SITE).filter((file) => file.endsWith('.html'));
const CSS = fs.readFileSync(path.join(SITE, 'styles.css'), 'utf8');
const SCRIPT = fs.readFileSync(path.join(SITE, 'site.js'), 'utf8');

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
/** The only other sites a page may link to (never load from): the project on GitHub. */
const LINKABLE = /^https:\/\/github\.com\/wilsonwaters\/wa-stay(?:[/?#]|$)/;

function load(page: string): Document {
  return new JSDOM(fs.readFileSync(path.join(SITE, page), 'utf8')).window.document;
}

/** The file a local URL in `page` points at, or undefined for an in-page anchor. */
function localFile(url: string): string | undefined {
  const pathPart = decodeURIComponent(url.split('#')[0].split('?')[0]);
  if (!pathPart) return undefined;
  const resolved = path.resolve(SITE, pathPart);
  return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? path.join(resolved, 'index.html')
    : resolved;
}

function srcsetUrls(srcset: string): string[] {
  return srcset
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

describe.each(PAGES)('site/%s', (page) => {
  const document = load(page);

  it('has one h1, a title, a description and a language', () => {
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.title.trim()).not.toBe('');
    expect(
      document.querySelector('meta[name="description"]')?.getAttribute('content')
    ).toBeTruthy();
    expect(document.documentElement.lang).toBe('en-AU');
  });

  it('loads nothing from another site', () => {
    const loaded = [
      ...[...document.querySelectorAll('link[href]')]
        .filter((link) => link.getAttribute('rel') !== 'canonical')
        .map((link) => link.getAttribute('href') ?? ''),
      ...[...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src') ?? ''),
      ...[...document.querySelectorAll('img')].flatMap((img) => [
        img.getAttribute('src') ?? '',
        ...srcsetUrls(img.getAttribute('srcset') ?? ''),
      ]),
    ];
    expect(loaded.filter((url) => EXTERNAL.test(url))).toEqual([]);
    expect(document.querySelectorAll('style, [style], iframe')).toHaveLength(0);
    expect(document.querySelectorAll('script:not([src])')).toHaveLength(0);
  });

  it('links only to its own files, its own anchors and the project on GitHub', () => {
    const problems: string[] = [];
    const ids = new Set([...document.querySelectorAll('[id]')].map((element) => element.id));
    for (const anchor of document.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href') ?? '';
      if (EXTERNAL.test(href)) {
        if (!LINKABLE.test(href)) problems.push(`${href}: not the project on GitHub`);
        continue;
      }
      if (href.startsWith('/')) problems.push(`${href}: absolute path breaks under /wa-stay/`);
      const [, hash] = href.split('#', 2) as [string, string | undefined];
      if (hash && !href.startsWith('#')) problems.push(`${href}: anchor into another page`);
      if (href.startsWith('#') && !ids.has(href.slice(1))) problems.push(`${href}: no such id`);
      const file = localFile(href);
      if (file && !fs.existsSync(file)) problems.push(`${href}: no such file`);
    }
    expect(problems).toEqual([]);
  });

  it('resolves every image, icon and stylesheet', () => {
    const urls = [
      ...[...document.querySelectorAll('link[href]')].map((link) => link.getAttribute('href')),
      ...[...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')),
      ...[...document.querySelectorAll('img')].flatMap((img) => [
        img.getAttribute('src'),
        ...srcsetUrls(img.getAttribute('srcset') ?? ''),
      ]),
    ].filter((url): url is string => !!url && !EXTERNAL.test(url));
    expect(urls.filter((url) => !fs.existsSync(localFile(url) ?? ''))).toEqual([]);
  });

  it('gives every image alt text and a size', () => {
    const problems = [...document.querySelectorAll('img')].flatMap((img) => {
      const name = img.getAttribute('src');
      return [
        ...(img.getAttribute('alt')?.trim() ? [] : [`${name}: no alt text`]),
        ...(img.getAttribute('width') && img.getAttribute('height') ? [] : [`${name}: no size`]),
      ];
    });
    expect(problems).toEqual([]);
  });

  it('gives icons no accessible name of their own', () => {
    for (const svg of document.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });
});

describe('site/styles.css', () => {
  it('loads its fonts and brushstrokes from the site itself', () => {
    const urls = [...CSS.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((url) => EXTERNAL.test(url))).toEqual([]);
    expect(urls.filter((url) => !fs.existsSync(path.join(SITE, url)))).toEqual([]);
    expect(CSS).not.toMatch(/@import/);
  });

  it("uses the app's colour tokens, unchanged", () => {
    const tokens = fs.readFileSync(path.join(ROOT, 'src/renderer/styles/tokens.css'), 'utf8');
    const app = new Map(
      [...tokens.matchAll(/(--ws-[a-z]+-\d+):\s*(\d+)\s+(\d+)\s+(\d+);/g)].map((m) => [
        m[1],
        '#' + [m[2], m[3], m[4]].map((c) => Number(c).toString(16).padStart(2, '0')).join(''),
      ])
    );
    const site = [...CSS.matchAll(/(--ws-[a-z]+-\d+):\s*(#[0-9a-f]{6});/gi)];
    expect(site.length).toBeGreaterThan(10);
    for (const [, name, hex] of site) {
      expect([name, hex.toLowerCase()]).toEqual([name, app.get(name)]);
    }
  });
});

describe('site/site.js', () => {
  it('asks GitHub for the latest release, and nothing else', () => {
    const urls = [...SCRIPT.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0]);
    expect(urls).toEqual(['https://api.github.com/repos/wilsonwaters/wa-stay/releases/latest']);
    // The page's Content-Security-Policy allows exactly that host.
    expect(
      load('index.html')
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content')
    ).toContain('connect-src https://api.github.com;');
  });
});

describe('site assets', () => {
  const same = (site: string, source: string) =>
    expect(fs.readFileSync(path.join(SITE, site))).toEqual(
      fs.readFileSync(path.join(ROOT, source))
    );

  it("are the app's fonts", () => {
    same(
      'assets/fonts/figtree-latin-wght-normal.woff2',
      'node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2'
    );
    same(
      'assets/fonts/fraunces-latin-opsz-normal.woff2',
      'node_modules/@fontsource-variable/fraunces/files/fraunces-latin-opsz-normal.woff2'
    );
  });

  it('are the generated logo, social image and brushstrokes', () => {
    same('assets/brand/wa-stay-lockup.svg', 'resources/brand/wa-stay-lockup.svg');
    same('assets/brand/wa-stay-mark-small.svg', 'resources/brand/wa-stay-mark-small.svg');
    same('assets/social.png', 'resources/brand/readme-banner.png');
    same('assets/brush/swash.svg', 'src/renderer/assets/brush/swash.svg');
    // The underline stretches to fit its words, as the app's Brushstroke does.
    const underline = fs.readFileSync(path.join(SITE, 'assets/brush/underline.svg'), 'utf8');
    expect(underline.replace(' preserveAspectRatio="none"', '')).toBe(
      fs.readFileSync(path.join(ROOT, 'src/renderer/assets/brush/underline.svg'), 'utf8')
    );
    expect(underline).toContain('preserveAspectRatio="none"');
  });
});
