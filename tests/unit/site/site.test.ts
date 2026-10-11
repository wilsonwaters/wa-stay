/**
 * @jest-environment node
 *
 * The website in site/ (published to GitHub Pages by .github/workflows/pages.yml):
 * every local link, image and stylesheet resolves; every image has alt text and its file's real
 * size; in-page anchors and labels exist; nothing loads from another site; the colours are the
 * app's tokens; the fonts, logo and brushstroke are the app's own files, unchanged; and site.js
 * points the download buttons at the Windows installer only when it should.
 */

import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';

const ROOT = path.resolve(__dirname, '../../..');
const SITE = path.join(ROOT, 'site');
const PAGES = fs.readdirSync(SITE).filter((file) => file.endsWith('.html'));
const HTML = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(SITE, 'styles.css'), 'utf8');
const SCRIPT = fs.readFileSync(path.join(SITE, 'site.js'), 'utf8');
/** Where the site is published until a custom domain is set (docs/website.md). */
const PUBLISHED = 'https://wilsonwaters.github.io/wa-stay/';
const RELEASE_PAGE = 'https://github.com/wilsonwaters/wa-stay/releases/latest';

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
/** The only other sites a page may link to (never load from): the project on GitHub. */
const LINKABLE = /^https:\/\/github\.com\/wilsonwaters\/wa-stay(?:[/?#]|$)/;

function load(page: string): Document {
  return new JSDOM(fs.readFileSync(path.join(SITE, page), 'utf8')).window.document;
}

/** The file a local URL points at, or undefined for an in-page anchor. */
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

/** Every URL a page loads: stylesheets, icons, fonts, scripts, images and picture sources. */
function loadedUrls(document: Document): string[] {
  return [
    ...[...document.querySelectorAll('link[href]')]
      .filter((link) => link.getAttribute('rel') !== 'canonical')
      .map((link) => link.getAttribute('href') ?? ''),
    ...[...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src') ?? ''),
    ...[...document.querySelectorAll('img')].flatMap((img) => [
      img.getAttribute('src') ?? '',
      ...srcsetUrls(img.getAttribute('srcset') ?? ''),
    ]),
    ...[...document.querySelectorAll('source[srcset]')].flatMap((source) =>
      srcsetUrls(source.getAttribute('srcset') ?? '')
    ),
  ];
}

describe.each(PAGES)('site/%s', (page) => {
  const document = load(page);

  it('has one h1, a title, a description and a language', () => {
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.title.trim()).not.toBe('');
    const description = document.querySelector('meta[name="description"]')?.getAttribute('content');
    expect(description?.length).toBeGreaterThan(50);
    // Search results cut longer descriptions short.
    expect(description?.length).toBeLessThanOrEqual(160);
    expect(document.documentElement.lang).toBe('en-AU');
  });

  it('loads nothing from another site', () => {
    expect(loadedUrls(document).filter((url) => EXTERNAL.test(url))).toEqual([]);
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
    for (const labelled of document.querySelectorAll('[aria-labelledby]')) {
      const id = labelled.getAttribute('aria-labelledby') ?? '';
      if (!ids.has(id)) problems.push(`aria-labelledby="${id}": no such id`);
    }
    expect(problems).toEqual([]);
  });

  it('resolves every image, icon, font, script and stylesheet', () => {
    const urls = loadedUrls(document).filter((url) => url && !EXTERNAL.test(url));
    expect(urls.length).toBeGreaterThan(10);
    expect(urls.filter((url) => !fs.existsSync(localFile(url) ?? ''))).toEqual([]);
  });

  it('gives every image alt text, and the size of the file it shows', async () => {
    const problems: string[] = [];
    const sized = [
      ...document.querySelectorAll('img'),
      ...document.querySelectorAll('source[srcset]'),
    ];
    for (const element of sized) {
      const file =
        element.getAttribute('src') ?? srcsetUrls(element.getAttribute('srcset') ?? '')[0];
      if (element.tagName === 'IMG' && !element.getAttribute('alt')?.trim())
        problems.push(`${file}: no alt text`);
      const width = Number(element.getAttribute('width'));
      const height = Number(element.getAttribute('height'));
      if (!width || !height) {
        problems.push(`${file}: no size`);
        continue;
      }
      if (/\.(png|webp|jpe?g)$/.test(file)) {
        const meta = await sharp(path.join(SITE, file)).metadata();
        if (meta.width !== width || meta.height !== height)
          problems.push(
            `${file}: is ${meta.width}×${meta.height}, the page says ${width}×${height}`
          );
      }
    }
    expect(problems).toEqual([]);
  });

  it('gives icons no accessible name of their own', () => {
    for (const svg of document.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });
});

describe('site/index.html', () => {
  const document = load('index.html');

  it('names its published address, and its share image is a file in the site', () => {
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(PUBLISHED);
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(
      PUBLISHED
    );
    const image = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
    expect(image?.startsWith(PUBLISHED)).toBe(true);
    expect(fs.existsSync(path.join(SITE, (image ?? '').slice(PUBLISHED.length)))).toBe(true);
  });

  it('allows GitHub, and nothing else, in its Content-Security-Policy', () => {
    const policy = document
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute('content');
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain('connect-src https://api.github.com;');
    expect(policy?.match(/https?:\/\/[^\s;]+/g)).toEqual(['https://api.github.com']);
  });
});

describe('site/styles.css', () => {
  it('loads its fonts and brushstroke from the site itself', () => {
    const urls = [...CSS.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((url) => EXTERNAL.test(url))).toEqual([]);
    expect(urls.filter((url) => !fs.existsSync(path.join(SITE, url)))).toEqual([]);
    expect(CSS).not.toMatch(/@import/);
  });

  it("uses the app's colour tokens, unchanged, and no colour outside them", () => {
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
    const root = CSS.match(/:root\s*\{[^}]*\}/)?.[0] ?? '';
    const outside = CSS.replace(root, '');
    expect(outside.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi)).toBeNull();
  });
});

describe('site/site.js', () => {
  const builder = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron-builder.json'), 'utf8'));
  /** The installer's name as electron-builder writes it for a release. */
  const installerName = (version: string) =>
    String(builder.win.artifactName).replace('${version}', version).replace('${ext}', 'exe');
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0';
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 Safari/605.1.15';

  function release(name = installerName('2.0.0')) {
    return {
      tag_name: 'v2.0.0',
      assets: [
        {
          name,
          browser_download_url: `https://github.com/wilsonwaters/wa-stay/releases/download/v2.0.0/${name}`,
        },
      ],
    };
  }

  /** Runs site.js in the page with a stubbed fetch; the download links and version shown after. */
  async function run(userAgent: string, fetchImpl: () => Promise<unknown>) {
    const dom = new JSDOM(HTML, { url: PUBLISHED, runScripts: 'outside-only' });
    Object.defineProperty(dom.window.navigator, 'userAgent', { value: userAgent });
    const fetch = jest.fn(fetchImpl);
    Object.assign(dom.window, { fetch });
    dom.window.eval(SCRIPT);
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    const { document } = dom.window;
    return {
      fetch,
      links: [...document.querySelectorAll('a[data-download]')].map((a) => a.getAttribute('href')),
      version: document.querySelector('[data-version]')?.textContent,
    };
  }

  const ok = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

  it('asks GitHub for the latest release, and nothing else', async () => {
    expect([...SCRIPT.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0]).sort()).toEqual([
      'https://api.github.com/repos/wilsonwaters/wa-stay/releases/latest',
      'https://github.com/wilsonwaters/wa-stay/releases/download/',
    ]);
    const { fetch } = await run(WINDOWS, () => ok(release()));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('on Windows, links straight to the installer electron-builder names, with its version', async () => {
    const { links, version } = await run(WINDOWS, () => ok(release()));
    expect(links.length).toBeGreaterThan(1);
    expect(new Set(links)).toEqual(
      new Set([
        `https://github.com/wilsonwaters/wa-stay/releases/download/v2.0.0/${installerName('2.0.0')}`,
      ])
    );
    expect(version).toBe(' · Version 2.0.0');
  });

  it('elsewhere, keeps the release page but still shows the version', async () => {
    const { links, version } = await run(MAC, () => ok(release()));
    expect(new Set(links)).toEqual(new Set([RELEASE_PAGE]));
    expect(version).toBe(' · Version 2.0.0');
  });

  it.each([
    ['no WA Stay installer yet', () => ok(release('Some-Other-Setup-1.2.0.exe'))],
    [
      'an installer somewhere else',
      () =>
        ok({
          assets: [
            { name: installerName('2.0.0'), browser_download_url: 'https://example.com/x.exe' },
          ],
        }),
    ],
    ['an error status', () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })],
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('keeps the release page with %s', async (_case, fetchImpl) => {
    const { links, version } = await run(WINDOWS, fetchImpl);
    expect(new Set(links)).toEqual(new Set([RELEASE_PAGE]));
    expect(version).toBe('');
  });
});

describe('site assets', () => {
  const same = (site: string, source: string) =>
    expect(fs.readFileSync(path.join(SITE, site))).toEqual(
      fs.readFileSync(path.join(ROOT, source))
    );

  it("are the app's fonts, with their licences", () => {
    same(
      'assets/fonts/figtree-latin-wght-normal.woff2',
      'node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2'
    );
    same(
      'assets/fonts/fraunces-latin-opsz-normal.woff2',
      'node_modules/@fontsource-variable/fraunces/files/fraunces-latin-opsz-normal.woff2'
    );
    same('assets/fonts/figtree-OFL.txt', 'node_modules/@fontsource-variable/figtree/LICENSE');
    same('assets/fonts/fraunces-OFL.txt', 'node_modules/@fontsource-variable/fraunces/LICENSE');
  });

  it('are the generated logo, social image and brushstroke', () => {
    same('assets/brand/wa-stay-lockup.svg', 'resources/brand/wa-stay-lockup.svg');
    same('assets/brand/wa-stay-mark-small.svg', 'resources/brand/wa-stay-mark-small.svg');
    same('assets/social.png', 'resources/brand/readme-banner.png');
    // The underline stretches to fit its words, as the app's Brushstroke does.
    const underline = fs.readFileSync(path.join(SITE, 'assets/brush/underline.svg'), 'utf8');
    expect(underline.replace(' preserveAspectRatio="none"', '')).toBe(
      fs.readFileSync(path.join(ROOT, 'src/renderer/assets/brush/underline.svg'), 'utf8')
    );
    expect(underline).toContain('preserveAspectRatio="none"');
  });

  it('are all used by the page', () => {
    const used = new Set(
      [...loadedUrls(load('index.html')), ...CSS.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)]
        .map((entry) => (typeof entry === 'string' ? entry : entry[1]))
        .map((url) => path.normalize(url))
    );
    const files = (dir: string): string[] =>
      fs.readdirSync(path.join(SITE, dir), { withFileTypes: true }).flatMap((entry) => {
        const child = path.join(dir, entry.name);
        return entry.isDirectory() ? files(child) : [child];
      });
    const unused = files('assets').filter(
      (file) =>
        !used.has(file) && !/OFL\.txt$/.test(file) && file !== path.join('assets', 'social.png')
    );
    expect(unused).toEqual([]);
  });
});
