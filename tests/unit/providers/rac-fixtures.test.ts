/**
 * Guards for RAC's terms (`ai-state/research/rac-terms.md`):
 *
 * - **Rule 7, the fixtures.** Every file in `tests/fixtures/providers/rac/` and
 *   `tests/e2e/fixtures/http/rac/` is trimmed to facts: no image URL but the placeholder
 *   pattern (and the widget's 1×1 lazy-load gif), only placeholder category descriptions,
 *   `<redacted>` for every `api_key`, `rest_api_data_id` and `online_cart_url`, and no email
 *   address, phone number or script.
 * - **Rule 1, the source.** Every URL in `src/main/providers/rac/` is on RAC's host; NewBook's
 *   image host is named only where photos are checked; and nothing names a cart address
 *   (`online_cart_url`, `/booking/?cart`).
 *
 * Each check is a function, run over the files and over a bad sample, so a check that can no
 * longer fail is caught too.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../../..');
const FIXTURE_DIRS = ['tests/fixtures/providers/rac', 'tests/e2e/fixtures/http/rac'];
const SOURCE_DIR = 'src/main/providers/rac';

/** The only photo address a fixture may hold. */
const PLACEHOLDER_IMAGE =
  /^https:\/\/driveau\.newbook\.cloud\/crop_800_450\/instances_0{32}_\d+\.jpg$/;
/** The widget's lazy-load placeholder: a 1×1 transparent gif, not a photo. */
const LAZY_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const PLACEHOLDER_DESCRIPTION = 'Placeholder description.';
const SECRET_KEYS = ['api_key', 'rest_api_data_id', 'online_cart_url'];
const RAC_HOST = 'parksandresorts.rac.com.au';

function filesIn(dir: string): string[] {
  const absolute = path.join(ROOT, dir);
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? filesIn(path.join(dir, entry.name))
        : [path.join(dir, entry.name).split(path.sep).join('/')]
    );
}

const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** What in `text` breaks rule 7, as messages ([] when nothing). */
function fixtureViolations(text: string): string[] {
  const found: string[] = [];
  // Images: every address of a photo, and every img source
  for (const [url] of text.matchAll(/https?:\/\/[^\s"'<>)\\]+/g)) {
    const photo = /\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i.test(url) || /newbook/i.test(url);
    if (photo && !PLACEHOLDER_IMAGE.test(url)) found.push(`image URL ${url}`);
  }
  for (const [, src] of text.matchAll(/\b(?:data-)?src(?:set)?\s*=\s*"([^"]*)"/gi)) {
    if (src !== LAZY_GIF && !PLACEHOLDER_IMAGE.test(src)) found.push(`image source ${src}`);
  }
  for (const [, description] of text.matchAll(
    /class="[^"]*\baccommodation-item__description\b[^"]*"[^>]*>([\s\S]*?)<\/div>/g
  )) {
    if (description.trim() !== PLACEHOLDER_DESCRIPTION) {
      found.push(`description "${description.trim().slice(0, 40)}"`);
    }
  }
  for (const key of SECRET_KEYS) {
    const values = text.matchAll(new RegExp(`${key}["']?\\s*[:=]\\s*["']?([^"'&\\s,}]*)`, 'g'));
    for (const [, value] of values) {
      if (value !== '<redacted>') found.push(`${key} is not <redacted>`);
    }
  }
  for (const [email] of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    found.push(`email address ${email}`);
  }
  const phones = [
    /\btel:/gi,
    /(?<![\d_])(?:\+?61[\s-]?|0)[2-478](?:[\s-]?\d){8}(?![\d_])/g,
    /(?<![\d_])1[38]00(?:[\s-]?\d){6}(?![\d_])/g,
  ];
  for (const pattern of phones) {
    for (const [phone] of text.matchAll(pattern)) found.push(`phone number ${phone}`);
  }
  if (/<script\b/i.test(text)) found.push('a <script>');
  return found;
}

/** What in a source file breaks rule 1, as messages ([] when nothing). */
function sourceViolations(text: string): string[] {
  const found: string[] = [];
  for (const [url] of text.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>)\\]*/gi)) {
    let host: string | undefined;
    try {
      host = new URL(url).host;
    } catch {
      host = undefined;
    }
    if (!url.startsWith('https://') || host !== RAC_HOST) found.push(`URL ${url}`);
  }
  for (const line of text.split('\n')) {
    if (/newbook\.cloud/i.test(line) && !/^export const RAC_IMAGE_HOST = /.test(line)) {
      found.push(`another host named: ${line.trim()}`);
    }
  }
  if (/online_cart_url|\/booking\/\?cart/.test(text)) found.push('a cart address');
  return found;
}

describe('RAC fixtures (terms rule 7)', () => {
  const files = FIXTURE_DIRS.flatMap(filesIn);

  it('finds the recorded pages and the synthetic block pages in both folders', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'tests/fixtures/providers/rac/book-now-busselton.html',
        'tests/fixtures/providers/rac/book-now-margaret-river.html',
        'tests/fixtures/providers/rac/blocked-403.html',
        'tests/fixtures/providers/rac/blocked-429.html',
        'tests/fixtures/providers/rac/challenge.html',
        'tests/e2e/fixtures/http/rac/book-now-busselton.html',
        'tests/e2e/fixtures/http/rac/book-now-margaret-river.html',
      ])
    );
  });

  it.each(files.map((file) => [file]))('%s is trimmed to facts', (file) => {
    expect(fixtureViolations(read(file))).toEqual([]);
  });

  it('labels the recorded pages with their page and date, and the block pages as synthetic', () => {
    for (const file of files.filter((f) => /book-now-[a-z-]+\.html$/.test(f))) {
      expect(read(file)).toMatch(
        /^<!-- Trimmed from https:\/\/parksandresorts\.rac\.com\.au\/[a-z-]+\/book-now\/ \(fetched \d{1,2} \w{3} \d{4}/
      );
    }
    for (const file of ['blocked-403.html', 'blocked-429.html', 'challenge.html']) {
      expect(read(`tests/fixtures/providers/rac/${file}`)).toMatch(
        /^<!-- Synthetic, written by hand/
      );
    }
  });

  it('catches what it guards against', () => {
    const bad = [
      '<img src="https://driveau.newbook.cloud/crop_800_450/instances_d895bd707965db25abb932aba767878f_6.jpg">',
      '<img data-src="https://example.com/photo.png">',
      '<div class="accommodation-item__description">Wake up to birdsong.</div>',
      '{"api_key":"instances_d895bd707965db25abb932aba767878f"}',
      '{"online_cart_url":"https://parksandresorts.rac.com.au/busselton/booking/?cart"}',
      'rest_api_data_id=0123456789abcdef',
      'Email: reservations@example.com.au',
      'Telephone: 08 9755 4241',
      'Free call: 1800 871 570',
      '<a href="tel:0897554241">call</a>',
      '<script>window.x = 1</script>',
    ];
    for (const sample of bad)
      expect([sample, fixtureViolations(sample).length]).not.toEqual([sample, 0]);
    expect(
      fixtureViolations(
        `<img src="${LAZY_GIF}" data-src="https://driveau.newbook.cloud/crop_800_450/instances_${'0'.repeat(32)}_7.jpg">` +
          '{"api_key":"<redacted>","online_cart_url":"<redacted>"} data-date-from="20270924"'
      )
    ).toEqual([]);
  });
});

describe('RAC source (terms rule 1)', () => {
  const files = filesIn(SOURCE_DIR).filter((file) => file.endsWith('.ts'));

  it('has the module files', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files.map((file) => [file]))(
    "%s names no URL but RAC's, the image host only where photos are checked, and no cart address",
    (file) => {
      expect(sourceViolations(read(file))).toEqual([]);
    }
  );

  it('catches what it guards against', () => {
    for (const sample of [
      "const API = 'https://apiau.newbook.cloud/cc_secure/1230';",
      "const SITE = 'http://parksandresorts.rac.com.au';",
      "fetch('https://rac.com.au/about-rac/site-info/disclaimer')",
      "if (url.includes('driveau.newbook.cloud')) {}",
      'const cart = tariff.online_cart_url;',
      'const url = `${base}/booking/?cart&rand=1`;',
    ]) {
      expect([sample, sourceViolations(sample).length]).not.toEqual([sample, 0]);
    }
    expect(
      sourceViolations(
        "export const RAC_SITE_URL = 'https://parksandresorts.rac.com.au';\n" +
          "export const RAC_IMAGE_HOST = 'driveau.newbook.cloud';"
      )
    ).toEqual([]);
  });
});
