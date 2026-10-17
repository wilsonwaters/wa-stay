/**
 * Guards for RAC's terms (`ai-state/research/rac-terms.md`):
 *
 * - **Rule 7, the fixtures.** Every file in `tests/fixtures/providers/rac/` and
 *   `tests/e2e/fixtures/http/rac/` is trimmed to facts: no image URL but the placeholder
 *   pattern (and the widget's 1×1 lazy-load gif), no NewBook instance key but the placeholder
 *   one (anywhere, not only in a photo's address), photo alt text only as "Photo <n>", only
 *   placeholder category descriptions (in whatever element), no description, inclusions,
 *   deposits, fees or membership copy in an availability answer, `<redacted>` for every
 *   `api_key`, `rest_api_data_id` and `online_cart_url`, and no email address, phone number,
 *   IP address, Cloudflare cookie or `cf-ray` value, or script. Each availability answer says
 *   where it was trimmed from and when (`_fixture`). The auto-cart's fixtures (`cart/`, R19)
 *   are synthetic and say so: their cart addresses are RAC's booking page with the made-up
 *   token of 32 zeros (`rest_api_data_id` is that token or `<redacted>` everywhere).
 * - **Rule 1, the source.** Every URL in `src/main/providers/rac/` is on RAC's host; NewBook's
 *   image host is named only where photos are checked; and nothing names a cart address
 *   (`online_cart_url`, `/booking/?cart`), except that the auto-cart (`holds.ts`) reads a
 *   tariff's `online_cart_url`.
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
/** The made-up cart token of the synthetic cart fixtures (R19): never a real one. */
const ZERO_TOKEN = '0'.repeat(32);
/** A token as a live one looks, built here so that no such token is written out in the tests. */
const LIVE_LOOKING_TOKEN = '0123456789abcdef'.repeat(2);
/** A synthetic cart address: RAC's booking page, `cart`, the zero token and a `rand`. */
const SYNTHETIC_CART_ADDRESS = new RegExp(
  `^https://parksandresorts\\.rac\\.com\\.au/[a-z-]+/booking/\\?cart&rest_api_data_id=${ZERO_TOKEN}&rand=\\d+$`
);
/** The auto-cart's synthetic fixtures, and the label each starts with. */
const CART_DIR = 'tests/fixtures/providers/rac/cart/';
const SYNTHETIC_LABEL =
  /^(?:<!-- |\{\s*"_fixture"\s*:\s*")Synthetic: written from RAC's NewBook scripts, not recorded\./;
/** The one RAC source file that may read a tariff's cart address. */
const CART_SOURCE = 'holds.ts';
/** Keys an availability answer's fixture drops: RAC's copy, an image, money terms. */
const DROPPED_KEYS = [
  'tariff_inclusions',
  'tariff_short_description',
  'membership_description',
  'membership_icon',
  'membership_discount_pricing',
  'deposits',
  'adjustment_fees',
];
/** A notice's text is a booking rule, kept as a fact; every other description is RAC's copy. */
const KEPT_DESCRIPTION_CLASS = 'booking-notification__description';
const RAC_HOST = 'parksandresorts.rac.com.au';
/** The parks besides Busselton whose answers for 6–8 Nov 2026 Explore's free counts use. */
const BULK_PARKS = [
  'cable-beach',
  'cervantes',
  'esperance',
  'margaret-river',
  'exmouth',
  'karri-valley',
  'monkey-mia',
];

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

/**
 * What in `text` breaks rule 7, as messages ([] when nothing). `synthetic`: a cart fixture
 * (R19), whose cart addresses may be synthetic ones.
 */
function fixtureViolations(raw: string, { synthetic = false } = {}): string[] {
  // JSON may escape its slashes (`https:\/\/…`): read it as written out.
  const text = raw.replace(/\\\//g, '/');
  const found: string[] = [];
  // Images: every address of a photo, and every img source
  for (const [url] of text.matchAll(/https?:\/\/[^\s"'<>)\\]+/g)) {
    // On a NewBook host (its image host among them); RAC's own NewBook proxy path is no photo
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      // Not a URL: judged by its whole text
    }
    const photo = /\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i.test(url) || /newbook/i.test(host);
    if (photo && !PLACEHOLDER_IMAGE.test(url)) found.push(`image URL ${url}`);
  }
  for (const [, src] of text.matchAll(/\b(?:data-)?src(?:set)?\s*=\s*"([^"]*)"/gi)) {
    if (src !== LAZY_GIF && !PLACEHOLDER_IMAGE.test(src)) found.push(`image source ${src}`);
  }
  for (const [, tag, classes, description] of text.matchAll(
    /<([a-z][a-z0-9]*)\b[^>]*\bclass="([^"]*description[^"]*)"[^>]*>([\s\S]*?)<\/\1>/gi
  )) {
    if (classes.split(/\s+/).includes(KEPT_DESCRIPTION_CLASS)) continue;
    const plain = description.replace(/<[^>]*>/g, '').trim();
    if (plain !== PLACEHOLDER_DESCRIPTION && plain !== '') {
      found.push(`description in a <${tag}> "${plain.slice(0, 40)}"`);
    }
  }
  for (const [key, value] of text.matchAll(/"([a-z_]*description)"\s*:\s*"((?:[^"\\]|\\.)*)"/gi)) {
    if (value !== '' && value !== PLACEHOLDER_DESCRIPTION) found.push(`description ${key}`);
  }
  for (const key of DROPPED_KEYS) {
    if (new RegExp(`["']${key}["']\\s*:`).test(text)) found.push(`a "${key}"`);
  }
  for (const [key] of text.matchAll(/instances_[0-9a-f]{32}/gi)) {
    if (key !== `instances_${'0'.repeat(32)}`) found.push(`a NewBook instance key ${key}`);
  }
  for (const [, alt] of text.matchAll(/\balt\s*=\s*"([^"]*)"/gi)) {
    if (alt !== '' && !/^Photo \d+$/.test(alt)) found.push(`photo alt text "${alt}"`);
  }
  for (const [ip] of text.matchAll(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g)) {
    if (ip.split('.').every((octet) => Number(octet) <= 255)) found.push(`IP address ${ip}`);
  }
  for (const [ip] of text.matchAll(/(?<![\w:])(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}(?![\w:])/gi)) {
    found.push(`IP address ${ip}`);
  }
  for (const [cookie] of text.matchAll(/\b(?:__cf_bm|_cfuvid|cf_clearance|__cfruid)\s*[=:]/gi)) {
    found.push(`a Cloudflare cookie ${cookie}`);
  }
  for (const [ray] of text.matchAll(/\bcf[-_]ray["']?\s*[:=]\s*["']?[0-9a-f]{8,}/gi)) {
    found.push(`a cf-ray value ${ray}`);
  }
  for (const key of SECRET_KEYS) {
    const values = text.matchAll(new RegExp(`${key}["']?\\s*[:=]\\s*["']?([^"'\\s,}]*)`, 'g'));
    for (const [, whole] of values) {
      const value = key === 'online_cart_url' ? whole : whole.split('&')[0];
      const allowed =
        value === '<redacted>' ||
        (key === 'rest_api_data_id' && value === ZERO_TOKEN) ||
        (key === 'online_cart_url' && synthetic && SYNTHETIC_CART_ADDRESS.test(value));
      if (!allowed) found.push(`${key} is not <redacted>`);
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

/**
 * What in a source file breaks rule 1, as messages ([] when nothing). `cartSource`: the
 * auto-cart (`holds.ts`), which may read a tariff's `online_cart_url`.
 */
function sourceViolations(text: string, { cartSource = false } = {}): string[] {
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
  if (/\/booking\/\?cart/.test(text) || (!cartSource && /online_cart_url/.test(text))) {
    found.push('a cart address');
  }
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
        'tests/fixtures/providers/rac/availability-busselton-2026-11-06-2n.json',
        'tests/fixtures/providers/rac/availability-busselton-school-holidays-2027-09-25-2n.json',
        'tests/fixtures/providers/rac/availability-busselton-leavers-2027-11-20-1n.json',
        'tests/fixtures/providers/rac/availability-busselton-window-edge-2027-10-13-6n.json',
        'tests/fixtures/providers/rac/availability-busselton-window-after-midnight-2027-10-15-3n.json',
        'tests/fixtures/providers/rac/availability-exmouth-closed-2027-10-13-7n.json',
        'tests/fixtures/providers/rac/availability-exmouth-2026-10-31-1n.json',
        'tests/fixtures/providers/rac/availability-karri-valley-2026-10-31-1n.json',
        'tests/fixtures/providers/rac/availability-monkey-mia-2026-10-31-1n.json',
        'tests/fixtures/providers/rac/availability-no-direct-file-access.txt',
        'tests/e2e/fixtures/http/rac/book-now-busselton.html',
        'tests/e2e/fixtures/http/rac/book-now-margaret-river.html',
        'tests/e2e/fixtures/http/rac/availability-busselton-2026-11-06-2n.json',
        ...BULK_PARKS.flatMap((slug) => [
          `tests/fixtures/providers/rac/availability-${slug}-2026-11-06-2n.json`,
          `tests/e2e/fixtures/http/rac/availability-${slug}-2026-11-06-2n.json`,
        ]),
      ])
    );
  });

  it.each(files.map((file) => [file]))('%s is trimmed to facts', (file) => {
    expect(fixtureViolations(read(file), { synthetic: file.startsWith(CART_DIR) })).toEqual([]);
  });

  it('labels every auto-cart fixture as synthetic, and finds them (R19)', () => {
    const cart = files.filter((file) => file.startsWith(CART_DIR));
    expect(cart).toEqual(
      expect.arrayContaining([
        `${CART_DIR}cart-page-empty.html`,
        `${CART_DIR}cart-page-one-stay.html`,
        `${CART_DIR}cart-page-no-hold-fields.html`,
        `${CART_DIR}cart-page-refused.html`,
        `${CART_DIR}availability-busselton-2026-11-06-2n.json`,
        `${CART_DIR}remove-item-from-cart.json`,
      ])
    );
    for (const file of cart) expect([file, SYNTHETIC_LABEL.test(read(file))]).toEqual([file, true]);
    // No synthetic cart fixture outside the cart folder, and none in the e2e fixtures
    for (const file of files.filter((f) => !f.startsWith(CART_DIR))) {
      expect([file, SYNTHETIC_CART_ADDRESS.test(read(file))]).toEqual([file, false]);
    }
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
    const recorded = files.filter((f) => !f.startsWith(CART_DIR));
    for (const file of recorded.filter((f) => /\/availability-[^/]+\.json$/.test(f))) {
      const note = (JSON.parse(read(file)) as { _fixture?: string })._fixture;
      expect([file, note]).toEqual([
        file,
        expect.stringMatching(
          /^Trimmed from RAC Parks & Resorts' availability answer for .+ \(blog \d+\), .+, fetched anonymously; .+\(Fetched \d{1,2} \w{3} \d{4}, \d{2}:\d{2} Perth\.\)$/
        ),
      ]);
    }
  });

  it('catches what it guards against', () => {
    const bad = [
      '<img src="https://driveau.newbook.cloud/crop_800_450/instances_d895bd707965db25abb932aba767878f_6.jpg">',
      // A NewBook host's address, even with no image extension
      '{"photo":"https://driveau.newbook.cloud/crop_800_450/a-photo"}',
      '<img data-src="https://example.com/photo.png">',
      '{"photo":"https:\\/\\/driveau.newbook.cloud\\/crop_800_450\\/instances_d895bd70_6.jpg"}',
      '<div class="accommodation-item__description">Wake up to birdsong.</div>',
      '{"api_key":"instances_d895bd707965db25abb932aba767878f"}',
      '{"online_cart_url":"https://parksandresorts.rac.com.au/busselton/booking/?cart"}',
      `rest_api_data_id=${LIVE_LOOKING_TOKEN.slice(0, 16)}`,
      `rest_api_data_id=${'0'.repeat(31)}1`,
      `"online_cart_url":"https://parksandresorts.rac.com.au/busselton/booking/?cart&rest_api_data_id=${ZERO_TOKEN}&rand=1"`,
      'Email: reservations@example.com.au',
      'Telephone: 08 9755 4241',
      'Free call: 1800 871 570',
      '<a href="tel:0897554241">call</a>',
      '<script>window.x = 1</script>',
      // A bare NewBook instance key, outside any photo address
      '{"note":"instances_d895bd707965db25abb932aba767878f"}',
      // Photo alt text, a description in another element, and RAC's copy in an answer
      '<img alt="Sunset over the bay">',
      '<p class="accommodation-item__description">Wake up to birdsong.</p>',
      '<span class="category__description">Spacious and bright.</span>',
      '{"tariff_short_description":"Our most flexible rate"}',
      '{"membership_icon":"<redacted>"}',
      '{"deposits":[]}',
      '{"tariff_inclusions":[]}',
      // An IP address, Cloudflare's cookies and a cf-ray value
      'REMOTE_ADDR: 203.0.113.42',
      '"client_ip":"2001:db8:85a3:0:0:8a2e:370:7334"',
      'set-cookie: __cf_bm=abc123; path=/',
      '_cfuvid=xyz',
      'cf-ray: a4bc3afc690b4f8b-IAD',
    ];
    for (const sample of bad)
      expect([sample, fixtureViolations(sample).length]).not.toEqual([sample, 0]);
    expect(
      fixtureViolations(
        `<img src="${LAZY_GIF}" data-src="https://driveau.newbook.cloud/crop_800_450/instances_${'0'.repeat(32)}_7.jpg" alt="Photo 7">` +
          '{"api_key":"<redacted>","online_cart_url":"<redacted>"} data-date-from="20270924"' +
          '<div class="booking-notification__description"><p>Arrivals on Fridays only.</p></div>' +
          '<p class="accommodation-item__description">Placeholder description.</p>' +
          '{"timestamp":"2026-10-16 23:35:15","newbook_version":"2025.03.12-6acd5eef54202"}' +
          `rest_api_data_id=${ZERO_TOKEN}&rand=1 ` +
          // RAC's own NewBook proxy, on RAC's host, is no photo
          "newbook_api_path='https://parksandresorts.rac.com.au/busselton/wp-content/themes/parks-and-resorts/inc/newbook/api/rac-busselton-holiday-park.php?'"
      )
    ).toEqual([]);
    // A synthetic cart fixture: its cart address, with the zero token only, on RAC's booking page
    const synthetic = (address: string) =>
      fixtureViolations(`{"online_cart_url":"${address}"}`, { synthetic: true });
    expect(
      synthetic(
        `https://parksandresorts.rac.com.au/busselton/booking/?cart&rest_api_data_id=${ZERO_TOKEN}&rand=1001`
      )
    ).toEqual([]);
    for (const address of [
      `https://parksandresorts.rac.com.au/busselton/booking/?cart&rest_api_data_id=${LIVE_LOOKING_TOKEN}&rand=1`,
      `https://example.com/busselton/booking/?cart&rest_api_data_id=${ZERO_TOKEN}&rand=1`,
      `https://parksandresorts.rac.com.au/busselton/booking/?cart=Booking&rest_api_data_id=${ZERO_TOKEN}`,
    ]) {
      expect([address, synthetic(address).length]).not.toEqual([address, 0]);
    }
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
      expect(
        sourceViolations(read(file), { cartSource: path.basename(file) === CART_SOURCE })
      ).toEqual([]);
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
    // The auto-cart may read a tariff's cart address, but never names one itself
    expect(sourceViolations('const cart = tariff.online_cart_url;', { cartSource: true })).toEqual(
      []
    );
    expect(
      sourceViolations('const url = `${base}/booking/?cart&rand=1`;', { cartSource: true })
    ).not.toEqual([]);
    expect(
      sourceViolations(
        "export const RAC_SITE_URL = 'https://parksandresorts.rac.com.au';\n" +
          "export const RAC_IMAGE_HOST = 'driveau.newbook.cloud';"
      )
    ).toEqual([]);
  });
});
