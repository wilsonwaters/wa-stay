/**
 * The fake browser for provider tests (`tests/utils/fake-browser.ts`): a JavaScript search
 * form runs and renders its results; locators, roles, labels and text; navigation through the
 * site (links, GET and POST forms, redirects, script navigation, files, 404s); page functions
 * run in the page; page scripts' `fetch` goes to the site and nothing reaches the network;
 * unsupported methods and options throw; waits time out; abort and close behave like the real
 * browser; test contexts get no browser unless they set one up; and the fake compiles against
 * playwright-core's types.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import type { Page } from 'playwright-core';
import { isAbortError, PlaywrightBrowserAutomation } from '@main/providers/sdk';
import { createFakeBrowser, type FakeRouteMap } from '@tests/utils/fake-browser';
import { createTestProviderContext, testManifest } from '@tests/utils/fake-provider';

const ROOT = path.resolve(__dirname, '../../..');
const SITE = 'https://parks.test';
const CLOSED = 'Target page, context or browser has been closed';

const html = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

/** A search form whose script renders the results; the sites come from a same-origin script. */
const SEARCH = `<!doctype html><html lang="en"><head><title>Find a site | Parks</title>
<script src="/app.js"></script>
<script src="https://cdn.elsewhere.test/tracker.js"></script></head>
<body><main>
  <h1>Find a site</h1>
  <form id="search" aria-label="Search availability">
    <label for="arrive">Arrival date</label><input id="arrive" name="arrive" type="date">
    <label>Guests <input id="guests" name="guests" type="number" value="2"></label>
    <label for="kind">Site type</label>
    <select id="kind" name="kind">
      <option value="any">Any</option><option value="powered">Powered site</option><option value="cabin">Cabin</option>
    </select>
    <label><input type="checkbox" name="pets" value="yes"> Pets welcome</label>
    <button type="submit">Check availability</button>
  </form>
  <p id="log"></p>
  <div id="results" aria-live="polite"></div>
</main>
<script>
  const log = (text) => { document.getElementById('log').textContent += text + ';'; };
  document.getElementById('arrive').addEventListener('change', () => log('arrive change'));
  document.getElementById('guests').addEventListener('input', () => log('guests input'));
  document.getElementById('guests').addEventListener('change', () => log('guests change'));
  document.getElementById('search').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const out = document.getElementById('results');
    out.innerHTML = '<p role="status">Searching…</p>';
    setTimeout(() => {
      if (!form.get('arrive')) { out.innerHTML = '<p role="alert">Choose your dates</p>'; return; }
      const rows = window.SITES
        .filter((s) => form.get('kind') === 'any' || s.kind === form.get('kind'))
        .filter((s) => !form.get('pets') || s.pets)
        .filter((s) => s.sleeps >= Number(form.get('guests')))
        .map((s) => '<tr data-site="' + s.id + '"><th scope="row">' + s.name +
          '</th><td data-testid="price">$' + s.price.toFixed(2) + '</td></tr>');
      out.innerHTML = '<table aria-label="Results"><tbody>' + rows.join('') + '</tbody></table>';
    }, 30);
  });
</script></body></html>`;

const APP_JS = `window.SITES = [
  { id: 'p7', name: 'Powered site 7', kind: 'powered', price: 48.5, pets: true, sleeps: 6 },
  { id: 'p8', name: 'Powered site 8', kind: 'powered', price: 52, pets: false, sleeps: 6 },
  { id: 'c1', name: 'Cabin 1', kind: 'cabin', price: 145, pets: true, sleeps: 4 },
];`;

const PARKS = html(
  'Parks',
  `<style>.gone { display: none }</style>
  <header><nav aria-label="Main"><a href="/parks">Parks</a> <a href="/search">Search</a></nav></header>
  <main>
    <h1>Our parks</h1>
    <ul aria-label="Parks">
      <li data-park="sunset"><h2>Sunset Bay</h2><span data-testid="kind">Cabin</span><button>Book</button></li>
      <li data-park="karri"><h2>Karri Valley</h2><span data-testid="kind">Campground</span><button>Book</button></li>
      <li data-park="lake"><h2>Lake Kepwari</h2><span data-testid="kind">Cabin</span><button disabled>Book</button></li>
    </ul>
    <button class="gone">Secret</button>
    <button hidden>Hidden</button>
    <div aria-hidden="true"><button>Decoy</button></div>
    <div id="empty"></div>
    <fieldset disabled><legend>Extras</legend><input aria-label="Firewood"></fieldset>
    <input placeholder="Postcode" value="6280">
    <label><input type="checkbox" checked> Accessible</label>
    <p id="lines">Line one<br>Line two</p>
  </main>`
);

const START = html(
  'Start',
  `<a href="/parks">Parks</a> <a href="#top">Top</a>
  <form action="/find"><input name="q" aria-label="Search"></form>
  <form method="post" action="/enquire">
    <input name="name" aria-label="Name"><input name="nights" aria-label="Nights"><button>Send</button>
  </form>
  <button id="go">Go by script</button>
  <script>document.getElementById('go').addEventListener('click', () => location.assign('/parks?from=script'));</script>`
);

const SLOW = html(
  'Slow',
  `<div id="out"></div><p id="spinner">Loading</p>
  <script>setTimeout(() => {
    document.getElementById('out').innerHTML = '<p id="done">Done</p>';
    document.getElementById('spinner').remove();
  }, 40);</script>`
);

const LIVE = html(
  'Live',
  `<p id="out"></p><p id="held"></p><p id="xhr"></p>
  <script>
    fetch('/api/sites?kind=cabin').then((r) => r.json()).then((sites) => {
      document.getElementById('out').textContent = sites.map((s) => s.name).join(', ');
    });
    fetch('/api/hold', { method: 'POST', body: new URLSearchParams({ site: 'c1' }) })
      .then((r) => r.text()).then((text) => { document.getElementById('held').textContent = text; });
    try { new XMLHttpRequest(); } catch (error) { document.getElementById('xhr').textContent = error.message; }
  </script>`
);

let tempDir: string;
let routes: FakeRouteMap;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-browser-'));
  fs.writeFileSync(path.join(tempDir, 'page.html'), html('From a file', '<h1>Saved page</h1>'));
  routes = {
    '/search': SEARCH,
    '/app.js': { body: APP_JS, headers: { 'Content-Type': 'text/javascript' } },
    '/parks': PARKS,
    '/start': START,
    '/slow': SLOW,
    '/live': LIVE,
    '/broken': html('Broken', '<script>notAFunction();</script>'),
    '/find': (url) => html('Results', `<h1>Results for ${url.searchParams.get('q')}</h1>`),
    'POST /enquire': (_url, request) => html('Thanks', `<p id="body">${request.body}</p>`),
    '/old': { status: 301, headers: { Location: '/parks' } },
    '/file': { file: path.join(tempDir, 'page.html') },
    '/api/sites': (url) => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        [{ name: 'Cabin 1', kind: 'cabin' }].filter((s) => s.kind === url.searchParams.get('kind'))
      ),
    }),
    'POST /api/hold': (_url, request) => `held ${request.body}`,
    '/r': 'any query',
    '/r?x=1': 'exact query',
    'https://other.test/r': 'other origin',
    'POST /r': 'posted',
  };
});

afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

/** Waits (real time) until `done()`, for state a closed page settles a moment later. */
async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

describe('a JavaScript search form', () => {
  it('fills, selects, checks and submits it, and reads what its script renders', async () => {
    const fake = createFakeBrowser(routes);
    const rows = await fake.withPage(async (page) => {
      const response = await page.goto(`${SITE}/search`);
      expect(response?.status()).toBe(200);
      expect(await page.title()).toBe('Find a site | Parks');

      const form = page.getByRole('form', { name: 'Search availability' });
      await form.getByLabel('Arrival date').fill('2026-11-10');
      await form.getByLabel('Guests').fill('3');
      expect(await form.getByLabel('Site type').selectOption('Powered site')).toEqual(['powered']);
      await form.getByRole('checkbox', { name: 'Pets welcome' }).check();
      expect(await form.getByRole('checkbox', { name: 'Pets welcome' }).isChecked()).toBe(true);
      await form.getByRole('button', { name: 'Check availability' }).click();

      await page.getByRole('table', { name: 'Results' }).waitFor();
      // A date fires input and change at once; a text field gets change when focus moves on.
      expect(await page.locator('#log').textContent()).toBe(
        'arrive change;guests input;guests change;'
      );
      expect(await page.getByRole('status').count()).toBe(0);
      return page.getByRole('row').allInnerTexts();
    });

    expect(rows).toEqual(['Powered site 7 $48.50']);
    // The script prevented the submit, so no page was loaded for it.
    expect(fake.visits).toEqual([`${SITE}/search`]);
    expect(fake.requests).toContainEqual({
      resourceType: 'script',
      method: 'GET',
      url: `${SITE}/app.js`,
      status: 200,
    });
    // A script from another origin is refused, not fetched.
    expect(fake.requests).toContainEqual({
      resourceType: 'script',
      method: 'GET',
      url: 'https://cdn.elsewhere.test/tracker.js',
      status: null,
    });
    expect(fake.pageErrors).toEqual([]);
    expect(fake.openPages()).toBe(0);
  });

  it('submits on Enter, and shows what the script says about a form it rejects', async () => {
    const fake = createFakeBrowser(routes);
    const alert = await fake.withPage(async (page) => {
      await page.goto(`${SITE}/search`);
      await page.getByLabel('Guests').press('Enter');
      return page.getByRole('alert').textContent();
    });
    expect(alert).toBe('Choose your dates');
  });
});

describe('locators', () => {
  const fake = createFakeBrowser(() => PARKS);
  const onParks = <T>(fn: (page: Page) => Promise<T>): Promise<T> =>
    fake.withPage(async (page) => {
      await page.goto(`${SITE}/parks`);
      return fn(page);
    });

  it('find elements by role, with names, levels and states, leaving hidden ones out', async () => {
    await onParks(async (page) => {
      expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe('Our parks');
      expect(await page.getByRole('heading', { level: 2 }).allTextContents()).toEqual([
        'Sunset Bay',
        'Karri Valley',
        'Lake Kepwari',
      ]);
      // A name matches case-insensitively by substring, unless exact.
      expect(await page.getByRole('link', { name: 'parks' }).count()).toBe(1);
      expect(await page.getByRole('link', { name: 'parks', exact: true }).count()).toBe(0);
      expect(await page.getByRole('link', { name: /^sea/i }).textContent()).toBe('Search');
      const main = page.getByRole('navigation', { name: 'Main' });
      expect(await main.getByRole('link').allTextContents()).toEqual(['Parks', 'Search']);
      // display: none, hidden and aria-hidden are left out unless includeHidden.
      expect(await page.getByRole('button', { name: 'Secret' }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Hidden' }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Decoy' }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Secret', includeHidden: true }).count()).toBe(
        1
      );
      expect(await page.getByRole('checkbox', { checked: true }).count()).toBe(1);
      expect(await page.getByRole('checkbox', { name: 'Accessible' }).isChecked()).toBe(true);
      expect(await page.getByRole('button', { name: 'Book', disabled: true }).count()).toBe(1);
    });
  });

  it('find elements by label, text, test id and placeholder', async () => {
    await onParks(async (page) => {
      // The smallest element with the text.
      expect(await page.getByText('Sunset Bay').evaluate((el) => el.tagName)).toBe('H2');
      expect(await page.getByText('sunset').count()).toBe(1);
      expect(await page.getByText('Sunset', { exact: true }).count()).toBe(0);
      expect(await page.getByText(/kepwari/i).textContent()).toBe('Lake Kepwari');
      expect(await page.getByTestId('kind').allTextContents()).toEqual([
        'Cabin',
        'Campground',
        'Cabin',
      ]);
      expect(await page.getByPlaceholder('Postcode').inputValue()).toBe('6280');
      // Inside a disabled fieldset.
      expect(await page.getByLabel('Firewood').isDisabled()).toBe(true);
      expect(await page.getByLabel('Firewood').isEnabled()).toBe(false);
    });
  });

  it('chain, filter, pick and combine', async () => {
    await onParks(async (page) => {
      const items = page.getByRole('list', { name: 'Parks' }).getByRole('listitem');
      expect(await items.count()).toBe(3);
      expect(await items.filter({ hasText: 'Cabin' }).count()).toBe(2);
      expect(await items.filter({ hasNotText: 'Cabin' }).getAttribute('data-park')).toBe('karri');
      const full = items.filter({ has: page.getByRole('button', { disabled: true }) });
      expect(await full.getAttribute('data-park')).toBe('lake');
      expect(
        await items.filter({ hasNot: page.getByRole('button', { disabled: true }) }).count()
      ).toBe(2);
      expect(await items.nth(1).getByRole('heading').textContent()).toBe('Karri Valley');
      expect(await items.first().getAttribute('data-park')).toBe('sunset');
      expect(await items.last().getAttribute('data-park')).toBe('lake');
      expect(await items.nth(-2).getAttribute('data-park')).toBe('karri');
      const all = await items.all();
      expect(await Promise.all(all.map((item) => item.getAttribute('data-park')))).toEqual([
        'sunset',
        'karri',
        'lake',
      ]);
      expect(await items.locator('h2', { hasText: 'Valley' }).textContent()).toBe('Karri Valley');
      expect(await items.locator(page.getByRole('button')).count()).toBe(3);
      const either = page.getByText('Sunset Bay').or(page.getByText('Karri Valley'));
      expect(await either.count()).toBe(2);
      expect(await page.getByRole('button').and(page.locator('[disabled]')).count()).toBe(1);
      expect(String(items.nth(1))).toBe(
        "getByRole('list', { name: 'Parks' }).getByRole('listitem').nth(1)"
      );
    });
  });

  it('read text, visibility and state', async () => {
    await onParks(async (page) => {
      expect(await page.locator('#lines').innerText()).toBe('Line one\nLine two');
      expect(await page.locator('#lines').textContent()).toBe('Line oneLine two');
      expect(await page.locator('#lines').innerHTML()).toBe('Line one<br>Line two');
      expect(await page.getByRole('heading', { level: 1 }).isVisible()).toBe(true);
      expect(await page.locator('.gone').isVisible()).toBe(false);
      expect(await page.locator('button[hidden]').isHidden()).toBe(true);
      // No text, no box: not visible.
      expect(await page.locator('#empty').isVisible()).toBe(false);
      expect(await page.locator('#missing').isVisible()).toBe(false);
      expect(await page.locator('#missing').isHidden()).toBe(true);
      expect(await page.content()).toContain('<h1>Our parks</h1>');
    });
  });

  it('are strict, and wait for an element that can take the action', async () => {
    await onParks(async (page) => {
      await expect(page.getByRole('button', { name: 'Book' }).click()).rejects.toThrow(
        "locator.click: strict mode violation: getByRole('button', { name: 'Book' }) resolved to 3 elements"
      );
      await expect(page.locator('li').isVisible()).rejects.toThrow('strict mode violation');
      const error = await page
        .getByRole('button', { name: 'Book' })
        .last()
        .click({ timeout: 50 })
        .catch((e: unknown) => e as Error);
      expect(error).toMatchObject({ name: 'TimeoutError' });
      expect((error as Error).message).toBe(
        "locator.click: Timeout 50ms exceeded.\nwaiting for getByRole('button', { name: 'Book' }).last() to be enabled"
      );
      await expect(page.getByLabel('Firewood').fill('x', { timeout: 50 })).rejects.toThrow(
        'to be enabled'
      );
      await expect(page.getByRole('checkbox').fill('x')).rejects.toThrow(
        'locator.fill: Error: Input of type "checkbox" cannot be filled'
      );
      await expect(page.locator('#lines').selectOption('x')).rejects.toThrow(
        'locator.selectOption: Error: Element is not a <select> element'
      );
    });
  });
});

describe('navigation through the site', () => {
  it('follows links, submits GET and POST forms, and runs location changes', async () => {
    const fake = createFakeBrowser(routes);
    await fake.withPage(async (page) => {
      await page.goto(`${SITE}/start`);
      await page.getByRole('link', { name: 'Parks' }).click();
      expect(page.url()).toBe(`${SITE}/parks`);
      expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe('Our parks');

      // A form with one field and no button submits on Enter.
      await page.goto(`${SITE}/start`);
      await page.getByRole('textbox', { name: 'Search' }).fill('karri');
      await page.getByRole('textbox', { name: 'Search' }).press('Enter');
      await page.waitForURL('**/find?q=karri');
      expect(await page.getByRole('heading').textContent()).toBe('Results for karri');

      await page.goto(`${SITE}/start`);
      await page.getByLabel('Name').fill('Pat');
      await page.getByLabel('Nights').fill('2');
      await page.getByRole('button', { name: 'Send' }).click();
      expect(await page.locator('#body').textContent()).toBe('name=Pat&nights=2');

      await page.goto(`${SITE}/start`);
      await page.getByRole('button', { name: 'Go by script' }).click();
      await page.waitForURL(/from=script$/);
      expect(page.url()).toBe(`${SITE}/parks?from=script`);

      // Moving within the page is not a navigation.
      await page.goto(`${SITE}/start`);
      await page.getByRole('link', { name: 'Top' }).click();
      await page.waitForURL(`${SITE}/start#top`);
    });

    expect(fake.visits).toEqual([
      `${SITE}/start`,
      `${SITE}/parks`,
      `${SITE}/start`,
      `${SITE}/find?q=karri`,
      `${SITE}/start`,
      `${SITE}/enquire`,
      `${SITE}/start`,
      `${SITE}/parks?from=script`,
      `${SITE}/start`,
    ]);
    expect(fake.requests).toContainEqual({
      resourceType: 'document',
      method: 'POST',
      url: `${SITE}/enquire`,
      body: 'name=Pat&nights=2',
      status: 200,
    });
  });

  it('follows redirects, reads files, reloads and answers 404 for anything else', async () => {
    const fake = createFakeBrowser(routes);
    await fake.withPage(async (page) => {
      const moved = await page.goto(`${SITE}/old`);
      expect([moved?.status(), moved?.url(), moved?.ok()]).toEqual([200, `${SITE}/parks`, true]);
      expect(moved?.headers()).toMatchObject({ 'content-type': 'text/html; charset=utf-8' });
      expect(page.url()).toBe(`${SITE}/parks`);

      await page.goto(`${SITE}/file`);
      expect(await page.title()).toBe('From a file');
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      expect(await page.getByRole('heading').textContent()).toBe('Saved page');

      const missing = await page.goto(`${SITE}/nowhere`, { waitUntil: 'domcontentloaded' });
      expect([missing?.status(), missing?.ok()]).toEqual([404, false]);
      expect(await missing?.text()).toContain('Not found');

      await expect(page.goto('/relative')).rejects.toThrow('Cannot navigate to invalid URL');
    });
    expect(fake.requests.filter((r) => r.resourceType === 'document')).toEqual([
      { resourceType: 'document', method: 'GET', url: `${SITE}/old`, status: 301 },
      { resourceType: 'document', method: 'GET', url: `${SITE}/parks`, status: 200 },
      { resourceType: 'document', method: 'GET', url: `${SITE}/file`, status: 200 },
      { resourceType: 'document', method: 'GET', url: `${SITE}/file`, status: 200 },
      { resourceType: 'document', method: 'GET', url: `${SITE}/nowhere`, status: 404 },
    ]);
  });

  it('routes by method, then exact query, then absolute URL', async () => {
    const fake = createFakeBrowser(routes);
    await fake.withPage(async (page) => {
      const bodyOf = async (url: string): Promise<string | null> => {
        await page.goto(url);
        return page.locator('body').textContent();
      };
      expect(await bodyOf(`${SITE}/r?y=2`)).toBe('any query');
      expect(await bodyOf(`${SITE}/r?x=1`)).toBe('exact query');
      expect(await bodyOf('https://other.test/r')).toBe('other origin');
      expect(await page.evaluate(() => fetch('/r', { method: 'POST' }).then((r) => r.text()))).toBe(
        'posted'
      );
    });
  });
});

describe('page functions', () => {
  it('run inside the page, from their source, with results serialised back', async () => {
    const fake = createFakeBrowser(routes);
    await fake.withPage(async (page) => {
      await page.goto(`${SITE}/parks`);
      expect(await page.evaluate(() => document.title)).toBe('Parks');
      expect(await page.evaluate((n) => n * 2, 21)).toBe(42);
      expect(await page.evaluate('document.querySelectorAll("li").length')).toBe(3);
      expect(await page.$eval('h1', (el) => el.textContent)).toBe('Our parks');
      expect(
        await page.$$eval('li', (els) => els.map((el) => el.getAttribute('data-park')))
      ).toEqual(['sunset', 'karri', 'lake']);
      expect(
        await page
          .locator('li')
          .first()
          .evaluate((el, prefix) => prefix + el.dataset.park, 'park:')
      ).toBe('park:sunset');
      expect(await page.locator('h2').evaluateAll((els) => els.length)).toBe(3);
      // As from a real browser: NaN and Dates survive, nodes do not.
      expect(
        await page.evaluate(() => ({ nan: Number('x'), when: new Date(0), node: document.body }))
      ).toEqual({ nan: NaN, when: new Date(0), node: undefined });
      // A page function cannot see Node's variables, as in a real browser.
      const secret = 'only in Node';
      await expect(page.evaluate(() => secret)).rejects.toThrow(
        'page.evaluate: ReferenceError: secret is not defined'
      );
      await expect(page.$eval('#missing', (el) => el.id)).rejects.toThrow(
        'page.$eval: Failed to find element matching selector "#missing"'
      );

      const karri = await page.$('li[data-park="karri"]');
      expect(await karri?.$eval('h2', (el) => el.textContent)).toBe('Karri Valley');
      expect(await karri?.textContent()).toBe('Karri ValleyCampgroundBook');
      expect(await page.evaluate((el) => el?.getAttribute('data-park'), karri)).toBe('karri');
      expect(await page.$$('li')).toHaveLength(3);
      expect(await page.$('#missing')).toBeNull();
      await page.goto(`${SITE}/start`);
      await expect(karri!.textContent()).rejects.toThrow(
        'elementHandle.textContent: Element is not attached to the DOM'
      );
    });
  });
});

describe('page scripts', () => {
  it("send fetch to the site, and can't reach the network any other way", async () => {
    const fake = createFakeBrowser(routes);
    const shown = await fake.withPage(async (page) => {
      await page.goto(`${SITE}/live`);
      await page.locator('#out', { hasText: 'Cabin' }).waitFor();
      await page.locator('#held', { hasText: 'held' }).waitFor();
      return page.locator('p').allTextContents();
    });
    expect(shown).toEqual([
      'Cabin 1',
      'held site=c1',
      'not supported by the fake browser: XMLHttpRequest (page scripts can use fetch)',
    ]);
    expect(fake.requests).toContainEqual({
      resourceType: 'fetch',
      method: 'GET',
      url: `${SITE}/api/sites?kind=cabin`,
      status: 200,
    });
    expect(fake.requests).toContainEqual({
      resourceType: 'fetch',
      method: 'POST',
      url: `${SITE}/api/hold`,
      body: 'site=c1',
      status: 200,
    });
  });

  it('report their uncaught errors, also in a timeout message', async () => {
    const fake = createFakeBrowser(routes);
    const error = await fake
      .withPage(async (page) => {
        await page.goto(`${SITE}/broken`);
        await page.locator('#results').waitFor({ timeout: 30 });
        return new Error('the wait did not time out');
      })
      .catch((e: unknown) => e as Error);
    expect(fake.pageErrors).toEqual(['ReferenceError: notAFunction is not defined']);
    expect(error.message).toBe(
      "locator.waitFor: Timeout 30ms exceeded.\nwaiting for locator('#results') to be visible\n" +
        'Page errors:\n  - ReferenceError: notAFunction is not defined'
    );
  });
});

describe('unsupported methods and options', () => {
  it('throw "not supported by the fake browser", never return undefined', async () => {
    const fake = createFakeBrowser(routes);
    await fake.withPage(async (page) => {
      const response = await page.goto(`${SITE}/parks`);
      expect(() => page.screenshot()).toThrow('not supported by the fake browser: page.screenshot');
      expect(() => page.keyboard).toThrow(
        'not supported by the fake browser: page.keyboard (use locator.fill or locator.press)'
      );
      expect(() => page.waitForTimeout(100)).toThrow(
        'not supported by the fake browser: page.waitForTimeout (wait for what the page shows'
      );
      expect(() => page.locator('li').first().boundingBox()).toThrow(
        'not supported by the fake browser: locator.boundingBox'
      );
      expect(() => response?.json()).toThrow('not supported by the fake browser: response.json');
      const handle = await page.$('h1');
      expect(() => handle?.boundingBox()).toThrow(
        'not supported by the fake browser: elementHandle.boundingBox'
      );
      expect(() => page.locator('text=Book')).toThrow(
        'not supported by the fake browser: selector "text=Book" (use CSS, the getBy… methods or filter)'
      );
      await expect(page.locator('h1').click({ button: 'right' })).rejects.toThrow(
        'not supported by the fake browser: locator.click option "button"'
      );
      await expect(page.getByPlaceholder('Postcode').press('a')).rejects.toThrow(
        "not supported by the fake browser: locator.press('a') (use fill to enter text)"
      );
    });
    await expect(fake.withPage(async () => 1, { trace: true } as never)).rejects.toThrow(
      'not supported by the fake browser: withPage option "trace"'
    );
  });
});

describe('waits and timeouts', () => {
  it('wait for what a script renders or removes', async () => {
    const fake = createFakeBrowser(routes);
    await fake.withPage(async (page) => {
      await page.goto(`${SITE}/slow`);
      await page.locator('#done').waitFor();
      await page.locator('#spinner').waitFor({ state: 'detached' });
      expect(await (await page.waitForSelector('#done'))?.textContent()).toBe('Done');
      expect(await page.waitForSelector('#spinner', { state: 'hidden' })).toBeNull();
      await page.waitForLoadState();
    });
  });

  it('time out at the page default, capped by the fake so a test fails fast', async () => {
    const fake = createFakeBrowser(routes, { timeoutMs: 100 });
    await fake.withPage(
      async (page) => {
        await page.goto(`${SITE}/slow`);
        const started = Date.now();
        // The provider's own 60 s timeout is capped at the fake's 100 ms.
        await expect(page.locator('#never').waitFor()).rejects.toThrow(
          'locator.waitFor: Timeout 100ms exceeded.'
        );
        expect(Date.now() - started).toBeLessThan(2_000);
        page.setDefaultTimeout(20);
        await expect(page.getByText('Nowhere').textContent()).rejects.toThrow(
          "locator.textContent: Timeout 20ms exceeded.\nwaiting for getByText('Nowhere')"
        );
        page.setDefaultNavigationTimeout(20);
        await expect(page.waitForURL('**/elsewhere')).rejects.toMatchObject({
          name: 'TimeoutError',
        });
      },
      { timeoutMs: 60_000 }
    );
  });
});

describe('the browser', () => {
  it('rejects with an AbortError, without a page, when the signal has already aborted', async () => {
    const fake = createFakeBrowser(routes);
    const fn = jest.fn(async () => 1);
    const error = await fake.withPage(fn, { signal: AbortSignal.abort() }).catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
    expect(fn).not.toHaveBeenCalled();
    expect(fake.peakOpenPages).toBe(0);
  });

  it('rejects at once on abort and closes the page, so what the call waits on fails', async () => {
    const fake = createFakeBrowser(routes);
    const controller = new AbortController();
    let inner: Error | undefined;
    const pending = fake.withPage(
      async (page) => {
        await page.goto(`${SITE}/slow`);
        controller.abort();
        await page
          .locator('#never')
          .waitFor({ timeout: 4_000 })
          .catch((e: Error) => {
            inner = e;
          });
      },
      { signal: controller.signal }
    );
    expect(isAbortError(await pending.catch((e: unknown) => e))).toBe(true);
    expect(fake.openPages()).toBe(0);
    await until(() => inner !== undefined);
    expect(inner?.message).toBe(`locator.waitFor: ${CLOSED}`);
  });

  it('runs one page at a time', async () => {
    const fake = createFakeBrowser(routes);
    const order: string[] = [];
    const visit = (name: string) =>
      fake.withPage(async (page) => {
        order.push(`${name} start`);
        await page.goto(`${SITE}/parks`);
        order.push(`${name} end`);
      });
    await Promise.all([visit('a'), visit('b')]);
    expect(order).toEqual(['a start', 'a end', 'b start', 'b end']);
    expect(fake.peakOpenPages).toBe(1);
  });

  it('is available until closed; closing closes its pages and refuses new ones', async () => {
    const fake = createFakeBrowser(routes, { providerId: 'parks' });
    expect(await fake.isAvailable()).toEqual({ available: true, channel: 'chrome' });
    const busy = fake.withPage(async (page) => {
      await page.goto(`${SITE}/slow`);
      await page.locator('#never').waitFor({ timeout: 4_000 });
    });
    await until(() => fake.visits.length === 1);

    await fake.close();

    expect(fake.openPages()).toBe(0);
    await expect(busy).rejects.toThrow(CLOSED);
    expect(await fake.isAvailable()).toEqual({ available: false, reason: 'closing' });
    await expect(fake.withPage(async () => 1)).rejects.toMatchObject({
      name: 'BrowserUnavailableError',
      reason: 'closing',
      providerId: 'parks',
    });
  });
});

describe('createTestProviderContext', () => {
  it('gives no browser unless the test sets one up: using it fails', async () => {
    const ctx = createTestProviderContext('plain');
    expect(ctx.browser).not.toBeInstanceOf(PlaywrightBrowserAutomation);
    await expect(ctx.browser.withPage(async () => 1)).rejects.toThrow(
      'This test did not set up a browser for "plain"'
    );
    await expect(ctx.browser.isAvailable()).rejects.toThrow('did not set up a browser');
    await expect(ctx.browser.close()).resolves.toBeUndefined();
  });

  it('uses the browser it is given', async () => {
    const fake = createFakeBrowser({ '/': html('Home', '<h1>Welcome</h1>') });
    const ctx = createTestProviderContext(testManifest('browsing'), { browser: fake });
    const title = await ctx.browser.withPage(async (page) => {
      await page.goto(`${SITE}/`);
      return page.title();
    });
    expect(title).toBe('Home');
  });
});

describe('types', () => {
  it("compile against playwright-core's: its method names and this test's use of Page", () => {
    const tsconfig = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
    const { options } = ts.parseJsonConfigFileContent(tsconfig.config, ts.sys, ROOT);
    const files = ['tests/utils/fake-browser.ts', 'tests/unit/utils/fake-browser.test.ts'];
    const program = ts.createProgram(
      files.map((file) => path.join(ROOT, file)),
      {
        ...options,
        noEmit: true,
        types: ['node', 'jest'],
        paths: { ...options.paths, '@tests/*': ['./tests/*'] },
      }
    );
    const errors = ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(errors).toEqual([]);
  }, 60_000);
});
