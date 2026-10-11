# Browser-driven providers

These notes are for authors of providers that have no API, such as holiday-park chains, Airbnb and RAC Parks & Resorts. Such a provider reads the provider's own website in a real browser through `ctx.browser`. Everything else (the manifest, registering the provider, the conformance suite) works as it does for any other provider: see [Adding a provider](adding-a-provider.md). `npm run provider:new -- <id> --browser` generates a browser provider to start from.

`ctx.browser` is a `PlaywrightBrowserAutomation` (`src/main/providers/sdk/browser-automation.ts`). It drives the **Microsoft Edge or Google Chrome already installed** on the person's computer through `playwright-core`. WA Stay never bundles or downloads a browser.

The worked example is the guide's **Example Holiday Parks** (`tests/fixtures/providers/example-browser/`, [walked through in the guide](adding-a-provider.md#5-a-browser-provider)): its availability appears only after a park page's search form runs, and its tests run it on the fake browser (`tests/utils/fake-browser.ts`) over its made-up site.

## Contents

- [Choosing `api`, `browser` or `hybrid`](#choosing-api-browser-or-hybrid)
- [The `withPage` lifecycle](#the-withpage-lifecycle)
- [Selectors](#selectors)
- [Waiting](#waiting)
- [Honouring `signal`](#honouring-signal)
- [Read data, not the DOM](#read-data-not-the-dom)
- [Mapping to the normalised types](#mapping-to-the-normalised-types)
- [Search-mode catalogues (`catalogMode: 'search'`)](#search-mode-catalogues-catalogmode-search)
- [Politeness](#politeness)
- [Headless detection and bot walls](#headless-detection-and-bot-walls)
- [Provider terms and genuine intent](#provider-terms-and-genuine-intent)
- [Headed mode for human steps](#headed-mode-for-human-steps)
- [Testing with the fake browser](#testing-with-the-fake-browser)
- [The real-browser smoke test](#the-real-browser-smoke-test)
- [Preview in the app](#preview-in-the-app)
- [The browser profile and privacy](#the-browser-profile-and-privacy)
- [Errors people see](#errors-people-see)

## Choosing `api`, `browser` or `hybrid`

Set `manifest.integration` to say how the provider talks to its site.

| `integration` | Choose it when | Your modules use |
| --- | --- | --- |
| `api` | The site has JSON (or plain HTML) endpoints that answer a normal HTTP request with the right headers. **Always prefer it.** It is faster, lighter on the person's computer and on the provider, and it breaks less often. | `ctx.http` only. |
| `browser` | There is no usable endpoint: pages are built by JavaScript from data you cannot request directly, or the site only answers a real browser engine. | `ctx.browser` for every module. |
| `hybrid` | Most data comes from endpoints, but one step needs a browser, such as a page that must run its own script before an endpoint answers. | `ctx.http` for most calls and `ctx.browser` for that step. |

Before you choose `browser`, open the site's network panel and look for the requests its pages make. Many "no API" sites load their data from an endpoint that `ctx.http` can call.

The browser profile and `ctx.http`'s session partition (`persist:provider-<id>`) are **separate cookie jars**. A `hybrid` provider must not assume that a sign-in in one is visible to the other.

## The `withPage` lifecycle

```ts
const parks = await ctx.browser.withPage(
  async (page) => {
    await page.goto(`${BASE}/parks`, { waitUntil: 'domcontentloaded' });
    return page.$$eval('[data-location]', readParks);
  },
  { signal, timeoutMs: 30_000 }
);
```

`withPage(fn, { headed = false, timeoutMs = 60_000, signal })` does the following:

1. **It loads `playwright-core` on first use only.** App start-up, and providers that never automate, pay nothing for it.
2. **It launches one persistent context per provider, lazily, and reuses it.** Chromium locks a profile directory, so a provider never has two.
   - It finds a browser by trying channels in platform order: `msedge` then `chrome` on Windows (Edge is on every Windows 10/11 machine), and `chrome` then `msedge` on macOS and Linux.
   - It remembers the channel that worked in `ctx.state` (`browser.channel`) and tries it first next time.
3. **It gives `fn` a page.** The first call after a launch reuses the blank page Chromium opens the context with; every later call opens a new page (the previous call's pages are all closed). It applies `timeoutMs` to `page.setDefaultTimeout` and `page.setDefaultNavigationTimeout`, and runs `fn(page)`.
4. **It always closes every page the call opened** when `fn` returns or throws, popups included. The context then has no pages.
5. **It serialises calls per provider.** Two `withPage` calls on one provider run strictly one after the other (concurrency 1). Calls on different providers run independently.

The context is set up the same way for every provider:

- viewport 1280 × 800, locale `en-AU`, and `timezoneId` from `manifest.timezone`;
- `acceptDownloads: false`;
- the browser's own user agent. Never override it;
- **Chromium's sandbox on** (`chromiumSandbox: true`). Playwright otherwise starts Chromium with `--no-sandbox`, and the person's own Edge or Chrome must keep its sandbox while it visits third-party sites. Only a development `WA_STAY_BROWSER_PATH` build keeps Playwright's default (no sandbox), because it often runs as root in CI or a container, where Chromium cannot start sandboxed.

Around that:

- **Idle close.** The context closes after 5 minutes with no `withPage` call. The next call relaunches it.
- **Crashes.** If the browser crashes, updates itself or disconnects, the context is dropped and the next call relaunches it.
- **Quit.** `before-quit` hides the app's windows, then disposes the container (`src/main/app/quit-hold.ts`): it cuts the renderer off, starts `registry.disposeAll()`, which calls `ctx.browser.close()`, and closes the database. `close()` gives the browser 5 s to close, then kills its process, unless the browser has already exited (its process id may by then belong to something else). The quit waits for this at most 6 s (on Windows, a `taskkill` that hangs can add up to 2 s more). A `withPage` call during or after `close()` rejects with `BrowserUnavailableError` (`closing`).
- **`isAvailable()`** returns `{ available, channel?, reason? }`. It answers from the open context or the last launch when it can. Otherwise it probes each channel with a throwaway headless browser, never the provider's profile. A definitive answer is kept for the session; a `launch-failed` probe is not, so the next call probes again.

Rules for `fn`:

- **Do one unit of work per call**, such as list the parks or check one stay. A long `fn` holds the provider's only page and blocks every other call.
- **Never keep the `page`** (or a locator, element handle or listener) after `fn` returns. The page is closed.
- **Do not open extra contexts or browsers.** Use the page you are given. If the site opens a popup, it is closed with the page.
- **Return plain data**, not Playwright objects.

## Selectors

Pick selectors the site is least likely to change, in this order:

1. **Roles and accessible names:** `page.getByRole('button', { name: 'Check availability' })`, `getByLabel('Arrival date')`.
2. **Test ids and data attributes the site sets on purpose:** `getByTestId('park-name')`, `[data-location]`, `[data-night]`.
3. **Visible text**, for links and headings: `getByText('Our parks')`.

**Never use CSS class names.** Sites generate them (`.css-1x2y3z`), rename them in redesigns and share them between unrelated elements. Avoid positional selectors (`nth-child`, long XPath) for the same reason.

Keep every selector for a site in one place in your module, so a site change is a one-file fix.

## Waiting

Wait for the thing you need, never for a length of time.

- **Locators wait for you.** `locator.click()`, `fill()` and `textContent()` wait until the element is there and actionable.
- **Use explicit waits for a state:** `locator.waitFor({ state: 'visible' })`, `page.waitForURL('**/availability**')`, or `page.waitForResponse((r) => r.url().includes('/api/rates'))` when the data arrives by XHR.
- **Navigate with `waitUntil: 'domcontentloaded'`**, then wait for the element that holds your data. `'networkidle'` is slow and never settles on sites that poll.
- **Never use `page.waitForTimeout()`, `setTimeout` or retry loops with sleeps.** They are slow when the site is fast and flaky when it is slow.

Every wait is bounded by `timeoutMs`. A timeout rejects with Playwright's `TimeoutError`, so let it propagate (or wrap it in a `ProviderError`) rather than retrying in place.

## Honouring `signal`

Every module method receives an `AbortSignal`. Pass it to `withPage`:

```ts
check: (externalId, stay, { signal } = {}) =>
  ctx.browser.withPage(async (page) => { /* … */ }, { signal }),
```

- **An abort rejects the call at once** with an `AbortError` and closes the page. Whatever `fn` is waiting on in the page then fails, so `fn` unwinds by itself.
- **A call that is still queued behind another call never runs** once it is aborted.
- **In a long `fn`** (paging through results, many dates), call `throwIfAborted(signal)` from `@main/providers/sdk` between steps.
- **Never swallow errors** in a `catch` inside `fn`. If you must catch, rethrow anything for which `isAbortError(error)` is true.

## Read data, not the DOM

Many sites that need a browser still load their data as JSON: a page script calls an endpoint, or the server embeds the page's initial state in the HTML. Read that JSON rather than the rendered markup. It is faster, carries the site's own ids and values, and survives redesigns that break selectors.

- **Data that arrives by XHR or `fetch`.** Start waiting for the response *before* the action that triggers it (a response that arrives before `waitForResponse` is called is missed), then read its body:

  ```ts
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === '/api/search' && r.ok()),
    page.goto(searchUrl, { waitUntil: 'domcontentloaded' }),
  ]);
  const data: unknown = await response.json();
  ```

  Match on the endpoint's path, not the whole URL with its query string.
- **Data embedded in the page.** Frameworks often ship the page's state as JSON in a script tag, such as Next.js's `<script id="__NEXT_DATA__" type="application/json">`. Read its text and parse it in Node:

  ```ts
  const text = await page.locator('script#__NEXT_DATA__').textContent();
  const data: unknown = text ? JSON.parse(text) : undefined;
  ```

  Prefer a script tag's text over `page.evaluate(() => window.__INITIAL_STATE__)`: it is plain data, and needs nothing from the site's scripts.
- **Validate it with a zod schema in Node** before you map it. The site's JSON is not a contract. A mismatch becomes a `ProviderParseError` with a clear message, not an `undefined` deep in the mapping.
- **Use only what the page itself loads.** Do not call the site's internal endpoints with parameters its pages never send, or page through them faster than a person browsing would.
- **If the endpoint answers a plain request** with the right headers, you may not need a browser for that step at all: use `ctx.http` (`hybrid` or `api`, above).

## Mapping to the normalised types

Read raw values in the page, then map them in Node.

- **Page functions run inside the browser.** A function passed to `$$eval`, `$eval` or `evaluate` can use only its arguments and browser globals. It cannot close over Node variables or imports. Results cross back as JSON, so return plain objects.
- **Keep page functions dumb.** Read text and attributes (see `readParks` in the example). Do the interpretation, such as parsing prices, mapping words to states and building keys, in ordinary Node code that you can unit test.
- **Build keys with `makeLocationKey(ctx.id, externalId)`.** Use the site's own stable id as `externalId`, never a position in a list.
- **Map the site's words to the normalised enums** with an explicit table, and fall back to the neutral value:
  - `NightState`: `available | booked | closed | not-released | unknown`. A word you do not recognise is `unknown`, never `available`.
  - `LocationKind`: an unknown kind is `other`.
- **Return only the stay's nights.** Filter to `arrival <= date < departure`, whatever the page shows. Set `fullyAvailable` only when every night is `available`.
- **Turn an error page into an error.** Check `response.status()` after `page.goto` and throw `ProviderHttpError` for a non-2xx status, as `open()` does in the example. A page that has no data is not an empty result.
- **Sanitise nothing yourself.** Return HTML for `descriptionHtml` as you found it; main sanitises it before it crosses IPC.

## Search-mode catalogues (`catalogMode: 'search'`)

A provider that cannot list every location, such as a marketplace with thousands of listings, sets `capabilities.catalogMode: 'search'` and implements `catalog.searchArea` instead of `listLocations`. The registry refuses a `search` provider without it.

```ts
catalog: {
  searchArea: ({ bbox, stay, cursor }, signal) =>
    ctx.browser.withPage(
      async (page) => {
        // The cursor is the site's results-page number, as a string.
        const resultsPage = cursor ? Number(cursor) : 1;
        const results = await readSearchPage(page, searchUrl(bbox, stay, resultsPage));
        return {
          items: results.listings.map((listing) => toLocationSummary(ctx.id, listing)),
          nextCursor: results.hasMore ? String(resultsPage + 1) : undefined,
        };
      },
      { signal }
    ),
  getLocation: (externalId, signal) => ctx.browser.withPage(/* … */, { signal }),
},
```

- **One results page per call.** `searchArea({ bbox, stay?, cursor? })` returns `{ items, nextCursor? }`, and each call is its own `withPage`. A caller that pages through results never holds the provider's only page for the whole crawl, and other calls (a watch check) can run between pages.
- **`bbox` is `[west, south, east, north]`** in degrees (`BoundingBox`). Translate it into the site's own map-search parameters. If the site searches by centre and zoom instead, derive them from the box, and drop items outside the box before you return them.
- **`stay`, when given,** narrows the search to locations bookable for those dates, if the site can filter that way. If it cannot, ignore it. Do not check availability item by item here.
- **The cursor is opaque to the core.** Encode what the next call needs to fetch the next page (a page number, an offset or the site's own continuation token) as a string, and decode it on that call. It must not rely on anything held between calls: the page is closed, and the next call may come minutes later, after the browser was relaunched. Never put cookies, tokens or personal details in it.
- **Return `nextCursor` only when there is another page.** Stop when the site says there are no more results. Never loop through every page inside one call.
- **Keep keys stable across pages.** A listing that moves between pages because the site re-sorts keeps the same `makeLocationKey(ctx.id, externalId)`.
- **Use the site's own page size.** Every page is a full browser visit. Leave it to the caller to decide how many pages it needs.

### How the app uses a search-mode catalogue

The catalogue service (`src/main/core/catalog/location-catalog.service.ts`) never syncs a `search` catalogue. Instead:

- **Explore asks for the area it shows.** Once the map has stayed still for half a second, Explore sends its area (all of WA when there is no map), for the providers its Provider filter allows. Main snaps it outwards to a grid (`catalogSearchArea` in `src/shared/utils/catalog-area.ts`), so a small pan or zoom reuses the last search, and calls `searchArea` with the snapped box and no `stay`.
- **At most 5 pages per area.** Main follows `nextCursor` for up to 5 pages, then stops: zooming in gives a smaller area and finer results. An area inside one whose search read every page, or inside one still being searched, is not asked again.
- **Areas the map has left are not finished.** Only the provider's 2 newest area searches go on to another page; an older one stops before its next page, keeps what it found, and its area is asked again after 60 s if the map comes back to it. A page that fails after the first keeps the pages before it.
- **Polite by default.** One search per area at a time; each area is asked at most once per `catalogTtlHours` while the app runs (main remembers the last 500 areas and texts), and a failed one not again for 60 s. Main's search calls stay within `maxConcurrentRequests`, each page has a 20 s deadline, and quitting aborts them.
- **Non-blocking.** Explore's results come from the stored catalogue at once, and `catalog.search` lists the providers still searching in `pending`. When a search stores places that were not stored before, main sends `catalog:updated` and Explore shows them.
- **Stored like synced places.** What a search finds is added to the stored catalogue, so text search, filters, the place page, availability and watches work for it. Search results are never removed, because watches and bookings may refer to them. A place found again is refreshed; a place the site has dropped keeps its stored copy, and its page shows that copy marked out of date.
- **Text search is optional.** If the site can search by name, implement `catalog.searchText(text, signal)`: one request, your best few dozen matches (main stores at most 100). Main calls it when someone types at least 3 characters into Explore's "Where" or a watch's location step, with the same caching and storage as area searches; the location step says "Searching {shortName}…" until its places arrive (for at most a minute, and not after an error). Without it, the location step finds only the places already seen on the map, and suggests browsing the provider's places on the Explore map to find more.
- **Explore loads at most 5,000 places.** Search results are kept, so a busy provider can pass that; main then logs a warning once per run, and Explore leaves places out.
- **Status.** `catalog.status()` shows a `search` catalogue with `search: { textSearch, searchedAt? }`. `syncing` is true while a search runs, and `lastError` holds the last search's error.

## Politeness

A browser visit costs the provider far more than an API call: it loads scripts, images and fonts. Keep the load to what one careful person would cause.

- **One page at a time.** `withPage` already serialises a provider's calls. Do not work around it, for example by opening several pages inside one `fn`.
- **Set `manifest.limits`** to match:
  - `maxConcurrentRequests: 1`;
  - `minWatchIntervalMinutes` generous enough for a page load (the example uses 60);
  - `catalogTtlHours` so the catalogue is crawled rarely (24 or more).
- **Set `release.pollFloorMs`** (`{ window, continuous }`) if the provider supports snipes. Core services never poll faster than these floors. Pick floors for a page load, not for an API call.
- **Fetch only what the stay needs.** Ask for the stay's dates, not a whole season, and do not pre-fetch pages "just in case".
- **Never solve, bypass or outsource a CAPTCHA**, and do not use stealth plugins, fingerprint spoofing or a fake user agent. If a CAPTCHA, bot wall or "unusual traffic" page appears, stop and fail with a clear error. Do not retry in a loop.
- **Back off on errors.** A `429`, `503` or block page means slow down. Throw a `ProviderError` that says so, and stop: do not retry inside the module. The core does not retry either: it logs `retryable`, records the failure (a watch shows the error) and tries again only at the next scheduled run, at the watch's normal interval. If the site keeps asking you to slow down, raise `minWatchIntervalMinutes` and fetch less ([timeouts, failures and retries](adding-a-provider.md#9-timeouts-failures-and-retries)).

## Headless detection and bot walls

Some sites treat a headless browser differently. Chromium's headless user agent contains `HeadlessChrome`, and a site may answer it with a CAPTCHA, a "browser not supported" or "access denied" page, an "unusual traffic" wall, or results that are quietly empty.

- **Detect it, then stop.** Check for these pages (and for data that should be there and is not) and throw a `ProviderError` that says the site did not let WA Stay read it, for example *"Fake Parks did not allow WA Stay to read its site. Use the site directly."* Do not retry in a loop.
- **Do not spoof or evade.** Never set or edit the user agent (for example to strip `HeadlessChrome`), patch `navigator.webdriver`, use stealth plugins, randomise fingerprints, rotate addresses, or solve or outsource a CAPTCHA. Do not switch to `headed: true` to get past a wall either: headed mode is for a person's own step, such as signing in.
- **Respect the provider's terms.** A site that blocks automated access has said it does not want it. Re-read its terms ([below](#provider-terms-and-genuine-intent)); if they forbid automation, the provider gets links only, not a browser module.

## Provider terms and genuine intent

Read the provider's terms of use before you write a module, and record what they say about automated access in the module's notes.

- **If the terms forbid automated access, do not build a browser module.** A provider can still be listed with links only.
- **Genuine intent.** WA Stay acts for one person, for stays they really mean to take. A browser provider must follow the same rules as ParkStay ([Site Sniper](../site-sniper.md#book-responsibly)):
  - one account per person;
  - one booking per night;
  - holds only on the person's own account, in their own name;
  - no booking for others, no transfer or resale.
- **Payment is always a human step.** A module may place a hold. The person completes payment on the provider's own site.

## Headed mode for human steps

Headless is the default. Use `headed: true` only for a step a person must do themselves, such as signing in with a one-time code when the app's own sign-in window (an Electron window on the provider's partition, `browser-session` sign-in) cannot be used.

```ts
await ctx.browser.withPage(
  async (page) => {
    await page.goto(SIGN_IN_URL);
    // The person signs in; wait for the signed-in page, not for a time.
    await page.getByRole('link', { name: 'My bookings' }).waitFor();
  },
  { headed: true, timeoutMs: 5 * 60_000, signal }
);
```

- **Switching mode relaunches the browser.** Asking for headed mode while a headless context is open (or the reverse) closes the context and relaunches it in the requested mode, with a log line. It is the same profile, so cookies carry over.
- **The headed window closes when `fn` returns.** The next headless call relaunches headless.
- **Give the person time.** Use a long `timeoutMs` and wait for a page or element that proves the step is done.
- **Tell the person first.** The UI should say a browser window is about to open and why.
- **`ProviderAuth.kind: 'automation'`** (`signIn(browser, signal)`) is declared and validated. The account service does not implement it yet.

## Testing with the fake browser

Unit and contract tests never start a browser. `createTestProviderContext` (`tests/utils/fake-provider.ts`) gives a context whose browser fails the test unless you set one up; give it the fake browser from `tests/utils/fake-browser.ts`:

<!-- region: tests/unit/docs/example-providers.test.ts#test-fake-browser -->

```ts
describeProviderContract('example-browser', () => {
  // Pages come from the example site, in jsdom, its scripts running: the provider's own
  // page code runs against them.
  const fake = createFakeBrowser(renderExampleSite);
  const factory = createExampleBrowserFactory();
  return {
    provider: factory(createTestProviderContext(factory.manifest, { browser: fake })),
    sample: { externalId: 'sunset-bay', stay: STAY },
    unknownExternalId: 'nowhere',
    openPages: fake.openPages,
  };
});
```

- **Pages come from a fixture site you write**, a route map (`{ '/parks': '<html>…', 'POST /search': handler }`) or one handler for every URL, with the site's real attribute names, labels and words. Keep its data deterministic. The scaffold generates one (`tests/fixtures/providers/<id>/site.ts`); the example's is `tests/fixtures/providers/example-browser/site.ts`.
- **The pages run in jsdom, scripts and all.** Inline scripts and same-origin `<script src>` run; a form submit, a link click or a script navigation loads the next page from the site; a page script's `fetch` is answered by the site; nothing reaches the network.
- **Your real page code runs**: `goto`, locators (`getByRole`, `getByLabel`, `getByText`, `getByTestId`, `locator`, `filter`), `fill`, `click`, `selectOption`, `check`, `waitFor`, `$$eval`, `evaluate`, `waitForURL` and more, with Playwright's strictness, waits and timeouts. Anything it does not support throws "not supported by the fake browser: <name>" rather than returning nothing; the list is at the top of the file.
- **Assert on what happened**: `visits` (every page loaded), `requests` (pages, scripts and the page's `fetch` calls, with their status), `pageErrors` and `openPages()`. Pass `openPages` to the contract suite, as above, so it checks that no call leaves a page open.
- **Fixture mode in the app does not cover `ctx.browser`.** The Electron smoke tests serve only `ctx.http` from fixtures, so a browser provider is tested in Jest on the fake browser, and is not registered in a journey unless its pages are local ([preview in the app](#preview-in-the-app)).

Tests of the browser runtime itself (launch failures, crashes, a locked profile, a browser that will not close) mock `playwright-core` with `tests/utils/fake-playwright.ts` instead: see `tests/unit/providers/browser-automation.test.ts`. A provider does not need it.

## The real-browser smoke test

`tests/integration/browser-automation.smoke.test.ts` drives a small test provider (`tests/utils/fake-browser-provider.ts`) on a **real** browser, with no mocks, against its site served on loopback HTTP. It is skipped unless you opt in:

```bash
WA_STAY_BROWSER_E2E=1 npx jest tests/integration/browser-automation.smoke.test.ts
```

- **It detects the installed Edge or Chrome**, as the app does, and uses a throwaway profile.
- **To automate a specific Chromium build** (Linux CI, or a machine with neither browser), set `WA_STAY_BROWSER_PATH`:

  ```bash
  WA_STAY_BROWSER_E2E=1 WA_STAY_BROWSER_PATH=/path/to/chrome \
    npx jest tests/integration/browser-automation.smoke.test.ts
  ```

- **`WA_STAY_BROWSER_PATH` is for development only.** The running app also honours it, but only when it runs from source (unpackaged and not loaded from an asar archive, `src/main/app/app-source.ts`); a packaged build always detects Edge or Chrome itself. A browser started from this path runs without Chromium's sandbox (Playwright's default), so it can run as root in CI; Edge and Chrome found by detection always run sandboxed.

Copy this test for your provider and point it at a local fixture site, never at the live site: `serveFakeSite(site)` (`tests/utils/fake-site.ts`) serves your `site.ts` on loopback HTTP, answering as the fake browser does.

## Preview in the app

The preview spec (`PREVIEW_PROVIDER`, [adding a provider](adding-a-provider.md#12-preview-in-the-app)) cannot run a browser provider: fixture mode serves `ctx.http` only, and in the app `ctx.browser` drives a real browser at whatever address the provider names. Preview it by hand instead, against the made-up site its tests use, served on your own computer. Nothing reaches the provider's site, no certificate is involved, and nothing about TLS, the proxy or name resolution changes.

1. **Serve the site** (`tests/fixtures/providers/<id>/site.ts`) on loopback, in a terminal of its own:

   ```bash
   node scripts/serve-provider-site.mjs acme-parks     # http://127.0.0.1:8123; --port <n> for another port
   ```

   It answers exactly as the fake browser does (`serveFakeSite` in `tests/utils/fake-site.ts`), to this computer only, and prints each request the browser makes. Ctrl+C stops it. It serves the site's default export, or its `render…Site` function as the scaffold names it; `--export <name>` picks another.
2. **Point the provider at it, for now.** Set `ACME_PARKS_SITE_URL` in `src/main/providers/acme-parks/index.ts` to `'http://127.0.0.1:8123'`. The browser module checks no scheme: it opens whatever address the provider gives `page.goto`, a plain `http:` loopback address included. (`ctx.http` allows https, and plain `http:` only to a loopback host, `isAllowedRequestUrl` in `src/main/providers/sdk/http.ts`.) Chromium treats loopback as a secure origin. The provider's links point at your copy too while it is set.
3. **A browser to drive.**
   - On Windows and macOS, and on Linux with Chrome or Edge installed, the app finds the installed browser and runs it with Chromium's sandbox on, as it does for a person: nothing to set.
   - On Linux without either, download Playwright's Chromium (`npx playwright install chromium`, from Playwright's own download site; it says where it put it) and give its `chrome` executable to the app as `WA_STAY_BROWSER_PATH` in the next step. Like every `WA_STAY_BROWSER_PATH` browser it runs without Chromium's sandbox ([the real-browser smoke test](#the-real-browser-smoke-test)), so point it only at your loopback copy.
4. **Start the app** from source, in fixture mode, with only your provider:

   ```bash
   npm run build:e2e
   npx cross-env WA_STAY_E2E_FIXTURES_DIR=tests/e2e/fixtures/http WA_STAY_PROVIDERS=acme-parks WA_STAY_USER_DATA_DIR=tmp/preview-profile electron .
   ```

   On Linux without Chrome or Edge, add `WA_STAY_BROWSER_PATH=/path/to/chrome` after `cross-env`. Fixture mode keeps every request but the browser's off the network, and the browser visits only the address you set. Explore lists the site's places once the catalogue is read, 5 s after the window opens (a `search` catalogue is asked for the map's area: all of WA in a build without a map). A place's page, and its "Check availability" for Explore's dates, run in the real browser, the site's own scripts included. The site's terminal shows every page the browser asked for, and the app's log says `Browser launched`.
5. **Set the address back** (to `''`, or the provider's real https address) before you run the tests or commit. `npm test` fails while any provider source under `src/main/providers/` names a loopback address (`tests/unit/providers/no-loopback-addresses.test.ts`, which names the file and line), and a generated provider's own test fails while its address is not https, so a loopback address cannot ship by accident.

A browser provider with an account still checks its sign-in through `ctx.http`, so in fixture mode that request needs a route in `tests/e2e/fixtures/http/<id>/` ([the Electron smoke tests](adding-a-provider.md#the-electron-smoke-tests)).

## The browser profile and privacy

Each provider has its own persistent browser profile at:

```text
<userData>/providers/<id>/browser
```

`<userData>` is Electron's `app.getPath('userData')`. On Windows that is a folder under `%APPDATA%`.

- **What it holds.** Everything a browser profile holds for that provider's site: **cookies, including sign-in sessions**, local storage, cache and history. Keeping it means the person stays signed in between runs, as they would in their own browser.
- **Isolation.** It is not the person's own Edge or Chrome profile, and providers never share one.
- **Privacy note.** Anyone who can read the person's user-data folder can read these cookies. Never log cookies, tokens, form values or page content that holds personal details. Log URLs without query strings.
- **Locks.** If the folder is locked by a browser that did not exit, the launch is retried once after 1 s and then fails with `profile-locked`.
- **WA Stay never deletes a profile automatically.** Deleting the folder while the app is closed signs the person out of that provider's browser session.

## Errors people see

When automation cannot run, `withPage` rejects with `BrowserUnavailableError` (`code: 'browser-unavailable'`). Its `reason` says why, and its message is shown to the person (IPC maps it to `PROVIDER_ERROR`):

| `reason` | When | Message |
| --- | --- | --- |
| `no-browser` | Neither Edge nor Chrome is installed. | "WA Stay needs Microsoft Edge or Google Chrome installed to use {provider}" |
| `runtime-missing` | `playwright-core` could not be loaded (a broken installation). | Asks the person to reinstall WA Stay. |
| `profile-locked` | Another browser process holds the profile. Retryable. | Asks the person to close it and try again. |
| `launch-failed` | The browser was found but did not start. Retryable. | Asks the person to try again later. |
| `closing` | The app is quitting. | Not shown; the work is abandoned. |

Let these propagate from your modules unchanged. Do not catch them to retry, and do not replace the message.
