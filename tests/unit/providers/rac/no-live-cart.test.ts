/**
 * No live cart, ever (R19, architecture-notes §12.33): RAC's auto-cart is tested on synthetic
 * fixtures only, and nothing in the repository could open a real cart.
 *
 * - Every `rest_api_data_id` under `tests/` is the made-up token of 32 zeros or `<redacted>`:
 *   no real cart token is kept anywhere.
 * - Every file in `tests/fixtures/providers/rac/cart/` says it is synthetic, first thing.
 * - The e2e fixtures stay cart-free: RAC's `manifest.json` there has no route for a cart
 *   address, the cart page, NewBook's proxy or the card store, and no file there is a cart page.
 * - Nothing under `tests/manual/` or `scripts/` (what a person runs by hand) names a cart
 *   address or its token.
 *
 * Each check is a function, run over the files and over a bad sample.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../../../..');
const ZERO_TOKEN = '0'.repeat(32);
const TEXT_FILE = /\.(?:ts|tsx|js|mjs|cjs|json|html|txt|md|sql|csv)$/;
const CART_DIR = 'tests/fixtures/providers/rac/cart';
const E2E_RAC = 'tests/e2e/fixtures/http/rac';
const SYNTHETIC_LABEL =
  /^(?:<!-- |\{\s*"_fixture"\s*:\s*")Synthetic: written from RAC's NewBook scripts, not recorded\./;

function filesIn(dir: string): string[] {
  const absolute = path.join(ROOT, dir);
  if (!fs.existsSync(absolute)) return [];
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? entry.name === 'node_modules'
          ? []
          : filesIn(path.join(dir, entry.name))
        : [path.join(dir, entry.name).split(path.sep).join('/')]
    );
}

const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');

/**
 * Every `rest_api_data_id` token written out in `text` (a run of 8 or more hexadecimal
 * characters after its `=` or `:`, quoted, escaped or not) that is not the zero token.
 * `<redacted>`, a name and a value built at run time (`${…}`) are not written out.
 */
function realTokens(text: string): string[] {
  const values = text.matchAll(/rest_api_data_id(?:\\?["'])?\s*[=:]\s*(?:\\?["'])?([0-9A-Za-z]+)/g);
  // A token is a run of hexadecimal characters; a name (`ZERO_TOKEN`) or a word is none
  return [...values]
    .map(([, value]) => value)
    .filter((value) => /^[0-9a-f]{8,}$/i.test(value) && value !== ZERO_TOKEN);
}

/** What in RAC's e2e fixture routes could reach a cart, as messages ([] when nothing). */
function cartRoutes(manifest: { routes: Array<Record<string, unknown>> }): string[] {
  const found: string[] = [];
  for (const route of manifest.routes) {
    const where = String(route.path ?? '');
    const query = (route.query ?? {}) as Record<string, unknown>;
    if (/^\/[a-z0-9-]+\/booking\//.test(where)) found.push(`a cart page route ${where}`);
    if (/inc\/newbook\/api/.test(where)) found.push(`a NewBook proxy route ${where}`);
    if (/cc_secure|newbook\.cloud/.test(where)) found.push(`a card store route ${where}`);
    if ('cart' in query || 'rest_api_data_id' in query) found.push(`a cart address ${where}`);
    if (/cart/i.test(String(route.file ?? ''))) found.push(`a cart file ${String(route.file)}`);
  }
  return found;
}

describe('no live cart (R19)', () => {
  it('every rest_api_data_id under tests/ is the zero token or <redacted>', () => {
    const files = filesIn('tests').filter((file) => TEXT_FILE.test(file));
    expect(files.length).toBeGreaterThan(100);
    const found = files.flatMap((file) => realTokens(read(file)).map((t) => `${file}: ${t}`));
    expect(found).toEqual([]);
    // The synthetic cart fixtures do carry the zero token
    expect(read(`${CART_DIR}/availability-busselton-2026-11-06-2n.json`)).toContain(
      `rest_api_data_id=${ZERO_TOKEN}`
    );
  });

  it('every file in the cart fixtures starts with the synthetic label', () => {
    const files = filesIn(CART_DIR);
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const file of files)
      expect([file, SYNTHETIC_LABEL.test(read(file))]).toEqual([file, true]);
  });

  it("RAC's e2e fixtures have no route for a cart address, the cart page, the proxy or the card store, and no cart page", () => {
    const manifest = JSON.parse(read(`${E2E_RAC}/manifest.json`)) as {
      routes: Array<Record<string, unknown>>;
    };
    expect(manifest.routes.length).toBeGreaterThan(0);
    expect(cartRoutes(manifest)).toEqual([]);
    for (const file of filesIn(E2E_RAC)) {
      const text = read(file);
      expect([file, /cart_breakdown|newbook_api_path/.test(text)]).toEqual([file, false]);
      // A cart address (the photos' placeholder key is 32 zeros too, so the token alone is no sign)
      expect([file, /rest_api_data_id=|"online_cart_url":\s*"http/.test(text)]).toEqual([
        file,
        false,
      ]);
    }
  });

  it('nothing under tests/manual/ or scripts/ names a cart address or its token', () => {
    const files = [...filesIn('tests/manual'), ...filesIn('scripts')];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect([file, /online_cart_url|rest_api_data_id/.test(read(file))]).toEqual([file, false]);
    }
  });

  it('catches what it guards against', () => {
    const live = 'ab12'.repeat(8);
    expect(realTokens(`?cart&rest_api_data_id=${live}&rand=1`)).toEqual([live]);
    expect(realTokens(`{"rest_api_data_id": "${live}"}`)).toEqual([live]);
    expect(realTokens(`rest_api_data_id=${ZERO_TOKEN} rest_api_data_id=<redacted>`)).toEqual([]);
    expect(realTokens('{ rest_api_data_id: ZERO_TOKEN } rest_api_data_id=x')).toEqual([]);
    expect(
      cartRoutes({
        routes: [
          { method: 'GET', path: '/busselton/booking/', file: 'page.html' },
          { method: 'GET', path: '/x/', query: { cart: '' }, file: 'x.html' },
          { method: 'POST', path: '/busselton/wp-content/themes/p/inc/newbook/api/rac.php' },
          { method: 'POST', path: '/cc_secure/1230' },
          { method: 'GET', path: '/x/', file: 'cart-page.html' },
        ],
      })
    ).toHaveLength(5);
    expect(
      cartRoutes({ routes: [{ method: 'GET', path: '/busselton/book-now/', file: 'b.html' }] })
    ).toEqual([]);
  });
});
