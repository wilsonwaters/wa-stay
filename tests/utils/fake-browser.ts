/**
 * `createFakeBrowser(site)`: a `BrowserAutomation` for provider tests, backed by jsdom. Pages
 * come from a site you describe, their scripts run, and forms, links and script navigations go
 * back through the site, so a provider's real `withPage((page) => …)` code runs unchanged.
 *
 *   const fake = createFakeBrowser({
 *     '/parks': '<ul><li data-park="sunset">…</li></ul>',       // a path: any origin, any query
 *     'https://parks.test/search': { file: path.join(__dirname, 'search.html') },
 *     'POST /search': (url, request) => ({ body: resultsFor(request.body) }),
 *     '/old': { status: 302, headers: { location: '/parks' } },
 *   });
 *   const fake = createFakeBrowser((url) => renderMySite(url));  // or one handler for the site
 *   const provider = factory(createTestProviderContext(factory.manifest, { browser: fake }));
 *
 * The browser:
 * - `withPage(fn, { signal, timeoutMs, headed })` opens a fresh page (about:blank), runs `fn`
 *   and always closes the page. Calls run one at a time, like the real one. An abort rejects
 *   at once with an `AbortError` and closes the page, so whatever `fn` waits on fails.
 * - `isAvailable()` answers `{ available: true, channel: 'chrome' }`. After `close()` it answers
 *   `{ available: false, reason: 'closing' }` and `withPage` rejects with
 *   `BrowserUnavailableError` (`closing`).
 * - For assertions: `visits` (every document URL loaded, redirects included), `requests`
 *   (documents, scripts, stylesheets and page `fetch` calls, with their status), `pageErrors`
 *   (uncaught page script errors, resources that failed to load), `openPages()` (pass it to
 *   `describeProviderContract`) and `peakOpenPages`.
 *
 * Pages: inline scripts, and `<script src>` from the page's own origin, run (jsdom
 * `runScripts: 'dangerously'`, acceptable for local fixtures only); scripts and stylesheets
 * from other origins are refused. Nothing reaches the network: a page script's `fetch` goes to
 * the site, and `XMLHttpRequest`, `WebSocket` and `EventSource` throw. A form submit (GET or
 * POST; by a click, Enter, `requestSubmit()` or `submit()`), a link click and `location.assign`,
 * `replace`, `reload` or `href =` load the next page from the site unless a page script
 * prevented the default. Page functions (`evaluate`, `$eval`, `$$eval`, `locator.evaluate`)
 * run inside the page from their source text, as in a real browser: they may use only their
 * arguments and browser globals, and their results come back serialised.
 *
 * Supported API. Anything else throws "not supported by the fake browser: <name>"; nothing
 * returns undefined instead.
 * - page: `goto`, `reload`, `url`, `title`, `content`; `locator`, `getByRole`, `getByLabel`,
 *   `getByText`, `getByTestId`, `getByPlaceholder`; `$`, `$$`, `$eval`, `$$eval`, `evaluate`;
 *   `waitForSelector`, `waitForURL`, `waitForLoadState`; `setDefaultTimeout`,
 *   `setDefaultNavigationTimeout`, `isClosed`, `close`.
 * - locator: `locator`, the `getBy…` methods above, `filter` (`hasText`, `hasNotText`, `has`,
 *   `hasNot`, `visible`), `first`, `last`, `nth`, `and`, `or`; `count`, `all`,
 *   `allTextContents`, `allInnerTexts`; `textContent`, `innerText`, `innerHTML`,
 *   `getAttribute`, `inputValue`, `isVisible`, `isHidden`, `isEnabled`, `isDisabled`,
 *   `isChecked`; `click`, `fill`, `clear`, `press` (Enter, Escape and the arrow and paging
 *   keys), `selectOption`, `check`, `uncheck`; `waitFor`, `evaluate`, `evaluateAll`.
 * - elementHandle (from `$`, `$$` and `waitForSelector`): `$`, `$$`, `$eval`, `$$eval`, the
 *   read and action methods of a locator, `evaluate` and `dispose`.
 * - response (from `goto` and `reload`): `status`, `ok`, `url`, `statusText`, `headers`, `text`.
 * - Options that are not implemented (a right click, a `getByRole` option, …) throw the same
 *   error, and so do Playwright's selector extensions (`text=`, `xpath=`, `>>`, `:has-text()`,
 *   …): use CSS, the `getBy…` methods and `filter`.
 *
 * As in Playwright: locators are lazy and strict (an action on a locator that matches more
 * than one element is a strict mode violation); actions wait for the element to be attached,
 * visible and enabled (and editable, for `fill`); `fill` fires `input`, and `change` when focus
 * moves on (date, time and range inputs get both at once); an action that starts a navigation
 * resolves once the next page is in. Text and accessible names match case-insensitively by
 * substring unless `exact: true`, with whitespace normalised. Timeouts reject with an Error
 * named `TimeoutError` (not playwright-core's class: check `error.name`).
 *
 * Approximations: jsdom has no layout, so an element is visible when it is attached, not hidden
 * (`hidden`, `display: none`, `visibility: hidden`, `type="hidden"`) and has text or a form
 * control, image or other replaced element inside; `innerText` is the rendered text with one
 * line per block. A wait times out after the provider's own timeout or `timeoutMs` (default
 * 5 s), whichever is shorter, so a missing element fails a test quickly. Use real timers.
 *
 * Providers type their pages as playwright-core's `Page`. The fake is cast to it in one place,
 * `withPage` below; the method names it implements are checked against playwright-core's types.
 * Tests of `PlaywrightBrowserAutomation` itself (launch, channels, kill) mock playwright-core
 * with `tests/utils/fake-playwright.ts` instead.
 */

import { JSDOM, ResourceLoader, VirtualConsole, type DOMWindow, type FetchOptions } from 'jsdom';
import type { ElementHandle, Locator, Page, Response } from 'playwright-core';
import {
  BrowserUnavailableError,
  createAbortError,
  createLimiter,
  type BrowserAutomation,
  type BrowserAvailability,
  type WithPageOptions,
} from '@main/providers/sdk';
import { answerFakeSite, type FakeSiteResponse } from './fake-site';

// ---------------------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------------------

/** What made a request. */
export type FakeResourceType = 'document' | 'script' | 'stylesheet' | 'fetch' | 'other';

/** A request a page made, as a site handler sees it. */
export interface FakeSiteRequest {
  method: string;
  url: URL;
  resourceType: FakeResourceType;
  /** A POST form's fields, url-encoded, or the body of a page script's `fetch`. */
  body?: string;
}

/** A site's answer to a request. */
export interface FakeRoute {
  /** Default 200. A 301, 302, 303, 307 or 308 with a `location` header redirects. */
  status?: number;
  /** Response headers (names are case-insensitive). Default `content-type: text/html`. */
  headers?: Record<string, string>;
  /** The body: a page's HTML, a script, the JSON for a page script's `fetch`. */
  body?: string;
  /** The same as `body`, so `(url) => ({ status, html })` site renderers work unchanged. */
  html?: string;
  /** Reads the body from this file on each request (absolute, or from the working directory). */
  file?: string;
}

/** Answers a request: a route, a string of HTML, or `undefined` for a 404. */
export type FakeSiteHandler = (
  url: URL,
  request: FakeSiteRequest
) => FakeRoute | string | undefined;

/**
 * Routes by URL. A key is a path (`/parks/sunset`, on any origin) or an absolute URL
 * (`https://parks.test/parks/sunset`), optionally after a method (`POST /search`; otherwise
 * any method). A key with a query matches only that exact query; a key without one matches
 * any query. The most specific key wins: method, then exact query, then absolute URL. A value
 * is a route, a string of HTML, or a handler for that key. Anything else is a 404.
 */
export type FakeRouteMap = Record<string, FakeRoute | string | FakeSiteHandler>;

export type FakeBrowserSite = FakeRouteMap | FakeSiteHandler;

/** One request a page made, as the fake recorded it. */
export interface FakeRequestRecord {
  resourceType: FakeResourceType;
  method: string;
  url: string;
  body?: string;
  /** The site's status, or `null` when the fake refused it (a script from another origin). */
  status: number | null;
}

export interface FakeBrowserOptions {
  /** The provider id `BrowserUnavailableError` carries after `close()`. Default `test`. */
  providerId?: string;
  /** The longest any wait may take, in ms. Default 5000. */
  timeoutMs?: number;
}

export interface FakeBrowserAutomation extends BrowserAutomation {
  /** Every document URL a page loaded, in order, redirects included. */
  readonly visits: readonly string[];
  /** Every request pages made through the site, in order. */
  readonly requests: readonly FakeRequestRecord[];
  /** Uncaught errors from page scripts, and resources that failed to load. */
  readonly pageErrors: readonly string[];
  /** Pages open now. */
  openPages(): number;
  /** The most pages open at once. */
  readonly peakOpenPages: number;
}

/** A `selectOption` value given as an object. */
interface SelectOptionValue {
  value?: string;
  label?: string;
  index?: number;
}

// The method names the fake implements, checked against playwright-core's types.
type Of<T, K extends keyof T> = K;
type GetBy = 'getByRole' | 'getByLabel' | 'getByText' | 'getByTestId' | 'getByPlaceholder';
type Action =
  | 'textContent'
  | 'innerText'
  | 'innerHTML'
  | 'getAttribute'
  | 'inputValue'
  | 'isVisible'
  | 'isHidden'
  | 'isEnabled'
  | 'isDisabled'
  | 'isChecked'
  | 'click'
  | 'fill'
  | 'press'
  | 'selectOption'
  | 'check'
  | 'uncheck'
  | 'evaluate';
type PageMethod = Of<
  Page,
  | GetBy
  | 'goto'
  | 'reload'
  | 'url'
  | 'title'
  | 'content'
  | 'locator'
  | '$'
  | '$$'
  | '$eval'
  | '$$eval'
  | 'evaluate'
  | 'waitForSelector'
  | 'waitForURL'
  | 'waitForLoadState'
  | 'setDefaultTimeout'
  | 'setDefaultNavigationTimeout'
  | 'isClosed'
  | 'close'
>;
type LocatorMethod = Of<
  Locator,
  | GetBy
  | Action
  | 'clear'
  | 'locator'
  | 'filter'
  | 'first'
  | 'last'
  | 'nth'
  | 'and'
  | 'or'
  | 'count'
  | 'all'
  | 'allTextContents'
  | 'allInnerTexts'
  | 'waitFor'
  | 'evaluateAll'
>;
type HandleMethod = Of<ElementHandle, Action | '$' | '$$' | '$eval' | '$$eval' | 'dispose'>;
type ResponseMethod = Of<Response, 'status' | 'ok' | 'url' | 'statusText' | 'headers' | 'text'>;

const DEFAULT_TIMEOUT_MS = 5_000;
const POLL_MS = 10;
const MAX_REDIRECTS = 20;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const CLOSED = 'Target page, context or browser has been closed';

type Query = (roots: ParentNode[]) => ParentNode[];

interface LocatorSpec {
  query: Query;
  description: string;
}

/** Each fake locator's query, so locators combine (`has`, `and`, `or`, `locator(locator)`). */
const LOCATORS = new WeakMap<object, LocatorSpec>();
/** Each fake element handle's element, so a handle can be passed to a page function. */
const HANDLES = new WeakMap<object, Element>();

// ---------------------------------------------------------------------------------------
// Errors and options
// ---------------------------------------------------------------------------------------

function notSupported(name: string, hint?: string): Error {
  return new Error(`not supported by the fake browser: ${name}${hint ? ` (${hint})` : ''}`);
}

function timeoutError(api: string, ms: number, waiting: string, pageErrors: string[]): Error {
  const errors = pageErrors.map((error) => `\n  - ${error}`).join('');
  const error = new Error(
    `${api}: Timeout ${ms}ms exceeded.\n${waiting}${errors ? `\nPage errors:${errors}` : ''}`
  );
  error.name = 'TimeoutError';
  return error;
}

function strictModeViolation(api: string, description: string, count: number): Error {
  return new Error(`${api}: strict mode violation: ${description} resolved to ${count} elements`);
}

/** Throws for options that would change what a method does but are not implemented. */
function allowOptions(api: string, options: object | undefined, keys: readonly string[]): void {
  for (const [key, value] of Object.entries(options ?? {})) {
    if (value !== undefined && !keys.includes(key)) throw notSupported(`${api} option "${key}"`);
  }
}

/** Properties Jest, Node and `await` probe on any object: absent, not errors. */
const PROBES = new Set([
  'then',
  'toJSON',
  'asymmetricMatch',
  '$$typeof',
  'nodeType',
  'inspect',
  '_isMockFunction',
  '@@__IMMUTABLE_ITERABLE__@@',
  '@@__IMMUTABLE_RECORD__@@',
]);

/** `target`, where reading any other property throws "not supported by the fake browser". */
function strict<T extends object>(target: T, name: string, hints: Record<string, string> = {}): T {
  return new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === 'symbol' || property in object || PROBES.has(property)) {
        return Reflect.get(object, property, receiver);
      }
      throw notSupported(`${name}.${property}`, hints[property]);
    },
  });
}

const PAGE_HINTS: Record<string, string> = {
  waitForTimeout: 'wait for what the page shows, e.g. locator.waitFor(), not for a time',
  keyboard: 'use locator.fill or locator.press',
  click: 'use page.locator(selector).click()',
  fill: 'use page.locator(selector).fill(value)',
  textContent: 'use page.locator(selector).textContent()',
};

// ---------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();
const words = (list: string): Set<string> => new Set(list.split(' '));
const messageOf = (error: unknown): string =>
  error && typeof error === 'object' && 'message' in error
    ? `${(error as Error).name}: ${(error as Error).message}`
    : String(error);

type TextMatch = string | RegExp;

function matchesText(value: string, match: TextMatch, exact = false): boolean {
  const text = normalize(value);
  if (match instanceof RegExp) {
    match.lastIndex = 0;
    return match.test(text);
  }
  const wanted = normalize(match);
  return exact ? text === wanted : text.toLowerCase().includes(wanted.toLowerCase());
}

/** A value as Playwright prints it in a locator's description. */
function show(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`;
  if (value instanceof RegExp) return String(value);
  if (value && typeof value === 'object') {
    const locator = LOCATORS.get(value);
    if (locator) return locator.description;
    const fields = Object.entries(value).filter(([, v]) => v !== undefined);
    return `{ ${fields.map(([k, v]) => `${k}: ${show(v)}`).join(', ')} }`;
  }
  return String(value);
}

/** Unique elements in document order. */
function inOrder(nodes: ParentNode[]): Element[] {
  const elements = [...new Set(nodes)].filter((node): node is Element => node.nodeType === 1);
  return elements.sort((a, b) =>
    a === b ? 0 : a.compareDocumentPosition(b) & 4 /* b follows a */ ? -1 : 1
  );
}

function descendants(roots: ParentNode[]): Element[] {
  return inOrder(roots.flatMap((root) => Array.from(root.querySelectorAll('*'))));
}

/** `glob` as Playwright matches URLs: `*` within a path segment, `**` across, `{a,b}`. */
function globToRegExp(glob: string): RegExp {
  let pattern = '^';
  let inGroup = false;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      pattern += '.*';
      i++;
    } else if (c === '*') pattern += '[^/]*';
    else if (c === '{') {
      inGroup = true;
      pattern += '(';
    } else if (c === '}' && inGroup) {
      inGroup = false;
      pattern += ')';
    } else if (c === ',' && inGroup) pattern += '|';
    else pattern += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp(`${pattern}$`);
}

function urlMatcher(match: string | RegExp | ((url: URL) => boolean)): (url: string) => boolean {
  if (typeof match === 'function') return (url) => Boolean(match(new URL(url)));
  if (match instanceof RegExp) {
    return (url) => {
      match.lastIndex = 0;
      return match.test(url);
    };
  }
  const pattern = globToRegExp(match);
  return (url) => pattern.test(url);
}

// ---------------------------------------------------------------------------------------
// Rendering approximations (jsdom has no layout)
// ---------------------------------------------------------------------------------------

const NOT_RENDERED = words('head script style template noscript title meta link base');
/** Elements with a box of their own, text or not. */
const REPLACED = words(
  'img input select textarea button svg canvas video iframe object embed hr meter progress'
);
const BLOCKS = words(
  'address article aside blockquote caption dd details dialog div dl dt fieldset figcaption ' +
    'figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section summary ' +
    'table tbody tfoot thead tr ul'
);

const styleOf = (el: Element): CSSStyleDeclaration =>
  el.ownerDocument.defaultView!.getComputedStyle(el);

/** Not rendered by itself: `hidden`, `display: none`, or an element that never renders. */
function hiddenItself(el: Element): boolean {
  return (
    NOT_RENDERED.has(el.localName) || el.hasAttribute('hidden') || styleOf(el).display === 'none'
  );
}

/** Hidden by markup or CSS, on itself or an ancestor. */
function hiddenByStyle(el: Element): boolean {
  if (el.localName === 'input' && (el as HTMLInputElement).type === 'hidden') return true;
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (hiddenItself(node)) return true;
  }
  return styleOf(el).visibility === 'hidden';
}

/** Whether `el` would have a box: a replaced element, or rendered text inside. */
function hasBox(el: Element): boolean {
  if (REPLACED.has(el.localName)) return true;
  return Array.from(el.childNodes).some((node) =>
    node.nodeType === 3
      ? normalize(node.textContent ?? '') !== ''
      : node.nodeType === 1 && !hiddenItself(node as Element) && hasBox(node as Element)
  );
}

function isVisible(el: Element): boolean {
  return el.isConnected && !hiddenByStyle(el) && hasBox(el);
}

function hiddenForAria(el: Element): boolean {
  return Boolean(el.closest('[aria-hidden="true"]')) || hiddenByStyle(el);
}

/** The text of `el` without scripts, styles and the like (and without `skip`). */
function textOf(el: Element, skip?: Element): string {
  if (el.localName === 'input' && /^(button|submit|reset)$/.test((el as HTMLInputElement).type)) {
    return (el as HTMLInputElement).value;
  }
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) text += node.textContent ?? '';
    const child = node as Element;
    if (node.nodeType === 1 && child !== skip && !NOT_RENDERED.has(child.localName)) {
      text += textOf(child, skip);
    }
  }
  return text;
}

/** An approximation of `innerText`: the rendered text, one line per block. */
function innerTextOf(el: Element): string {
  if (hiddenByStyle(el)) return el.textContent ?? '';
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === 3) parts.push(node.textContent ?? '');
    if (node.nodeType !== 1) return;
    const child = node as Element;
    if (child !== el && hiddenItself(child)) return;
    if (child.localName === 'br') {
      parts.push('\n');
      return;
    }
    const block = BLOCKS.has(child.localName);
    if (block) parts.push('\n');
    child.childNodes.forEach(walk);
    parts.push(block ? '\n' : /^t[dh]$/.test(child.localName) ? ' ' : '');
  };
  walk(el);
  return parts.join('').split('\n').map(normalize).filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------------------
// Roles and accessible names (the common cases of html-aam and accname)
// ---------------------------------------------------------------------------------------

/** Roles whose accessible name comes from their content. */
const NAME_FROM_CONTENT = words(
  'button cell checkbox columnheader gridcell heading link menuitem menuitemcheckbox ' +
    'menuitemradio option radio row rowheader switch tab tooltip treeitem'
);
const LABELABLE = words('button input meter output progress select textarea');
const SIMPLE_ROLES: Record<string, string> = {
  article: 'article',
  aside: 'complementary',
  blockquote: 'blockquote',
  button: 'button',
  caption: 'caption',
  datalist: 'listbox',
  dd: 'definition',
  details: 'group',
  dialog: 'dialog',
  dt: 'term',
  fieldset: 'group',
  figure: 'figure',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  hr: 'separator',
  html: 'document',
  li: 'listitem',
  main: 'main',
  menu: 'list',
  meter: 'meter',
  nav: 'navigation',
  ol: 'list',
  optgroup: 'group',
  option: 'option',
  output: 'status',
  p: 'paragraph',
  progress: 'progressbar',
  search: 'search',
  table: 'table',
  tbody: 'rowgroup',
  td: 'cell',
  textarea: 'textbox',
  tfoot: 'rowgroup',
  thead: 'rowgroup',
  tr: 'row',
  ul: 'list',
};

function hasAuthorName(el: Element): boolean {
  return ['aria-label', 'aria-labelledby', 'title'].some((name) =>
    normalize(el.getAttribute(name) ?? '')
  );
}

function inputRole(input: HTMLInputElement): string | null {
  const type = input.type;
  if (/^(button|image|reset|submit)$/.test(type)) return 'button';
  if (type === 'checkbox' || type === 'radio') return type;
  if (type === 'range') return 'slider';
  if (type === 'number') return 'spinbutton';
  if (type === 'hidden' || type === 'file') return null;
  const list = input.hasAttribute('list');
  if (type === 'search') return list ? 'combobox' : 'searchbox';
  return list && /^(email|tel|text|url)$/.test(type) ? 'combobox' : 'textbox';
}

function roleOf(el: Element): string | null {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  const tag = el.localName;
  if (SIMPLE_ROLES[tag]) return SIMPLE_ROLES[tag];
  switch (tag) {
    case 'a':
    case 'area':
      return el.hasAttribute('href') ? 'link' : null;
    case 'footer':
    case 'header':
      if (el.closest('article, aside, main, nav, section')) return null;
      return tag === 'footer' ? 'contentinfo' : 'banner';
    case 'form':
      return hasAuthorName(el) ? 'form' : null;
    case 'section':
      return hasAuthorName(el) ? 'region' : null;
    case 'img':
      return el.getAttribute('alt') === '' ? 'presentation' : 'img';
    case 'input':
      return inputRole(el as HTMLInputElement);
    case 'select': {
      const select = el as HTMLSelectElement;
      return select.multiple || select.size > 1 ? 'listbox' : 'combobox';
    }
    case 'th':
      return el.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader';
    default:
      return null;
  }
}

/** Text for a name: hidden parts left out, images by their alt text. */
function nameText(el: Element, skip?: Element): string {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) text += node.textContent ?? '';
    if (node.nodeType !== 1 || node === skip) continue;
    const child = node as Element;
    if (hiddenItself(child) || child.getAttribute('aria-hidden') === 'true') continue;
    text += ` ${child.localName === 'img' ? (child.getAttribute('alt') ?? '') : nameText(child, skip)} `;
  }
  return text;
}

/** What labels `el`: its `aria-labelledby` elements, `aria-label` and `<label>`s, in that order. */
function labelTexts(el: Element): string[] {
  const texts: string[] = [];
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((id) => el.ownerDocument.getElementById(id));
    texts.push(parts.map((part) => (part ? nameText(part) : '')).join(' '));
  }
  texts.push(el.getAttribute('aria-label') ?? '');
  if (LABELABLE.has(el.localName)) {
    const labels = Array.from((el as HTMLInputElement).labels ?? []);
    texts.push(labels.map((label) => nameText(label, el)).join(' '));
  }
  return texts.map(normalize).filter(Boolean);
}

function accessibleName(el: Element): string {
  const [labelled] = labelTexts(el);
  if (labelled) return labelled;
  const tag = el.localName;
  const attr = (name: string): string => normalize(el.getAttribute(name) ?? '');
  if (tag === 'input') {
    const input = el as HTMLInputElement;
    if (/^(button|submit|reset)$/.test(input.type)) {
      if (input.hasAttribute('value')) return normalize(input.value);
      return input.type === 'submit' ? 'Submit' : input.type === 'reset' ? 'Reset' : '';
    }
    if (input.type === 'image') return attr('alt') || 'Submit';
  }
  if (tag === 'img' || tag === 'area') return attr('alt') || attr('title');
  const captionTag = ({ fieldset: 'legend', table: 'caption', figure: 'figcaption' } as const)[
    tag as 'fieldset'
  ];
  const caption = captionTag && Array.from(el.children).find((c) => c.localName === captionTag);
  if (caption) return normalize(nameText(caption));
  if (NAME_FROM_CONTENT.has(roleOf(el) ?? '')) {
    const content = normalize(nameText(el));
    if (content) return content;
  }
  return attr('title') || (tag === 'input' || tag === 'textarea' ? attr('placeholder') : '');
}

function isDisabled(el: Element): boolean {
  const control = LABELABLE.has(el.localName) || /^(option|optgroup|fieldset)$/.test(el.localName);
  return (control && el.matches(':disabled')) || Boolean(el.closest('[aria-disabled="true"]'));
}

const NOT_FILLABLE = /^(checkbox|radio|file|submit|button|reset|image|hidden)$/;
/** Input types Playwright sets in one go (firing `input` and `change`). */
const SET_VALUE_TYPES = words('color date time datetime-local month range week');

const isContentEditable = (el: Element): boolean =>
  /^(|true|plaintext-only)$/.test(el.getAttribute('contenteditable') ?? 'false');

const isEditable = (el: Element): boolean =>
  isContentEditable(el) || !(el as HTMLInputElement).readOnly;

/** true, false or 'mixed' for a checkbox or radio; undefined for anything else. */
function checkedState(el: Element): boolean | 'mixed' | undefined {
  if (el.localName === 'input' && /^(checkbox|radio)$/.test((el as HTMLInputElement).type)) {
    const input = el as HTMLInputElement;
    return input.indeterminate ? 'mixed' : input.checked;
  }
  if (!/^(checkbox|radio|switch|menuitemcheckbox|menuitemradio)$/.test(roleOf(el) ?? '')) {
    return undefined;
  }
  const aria = el.getAttribute('aria-checked');
  return aria === 'mixed' ? 'mixed' : aria === 'true';
}

function headingLevel(el: Element): number | undefined {
  const level = Number(el.getAttribute('aria-level') ?? /^h([1-6])$/.exec(el.localName)?.[1]);
  return Number.isInteger(level) ? level : undefined;
}

// ---------------------------------------------------------------------------------------
// Page functions: run in the page from their source, results serialised back
// ---------------------------------------------------------------------------------------

/** Absorbs the coverage counters (`cov_x().s[0]++`) `--coverage` compiles into page functions. */
const COVERAGE_SINK: unknown = new Proxy(function sink() {}, {
  get: (_target, property) => (property === Symbol.toPrimitive ? () => 0 : COVERAGE_SINK),
  set: () => true,
  apply: () => COVERAGE_SINK,
});

function compilePageFunction(
  win: DOMWindow,
  api: string,
  fn: unknown
): (...args: unknown[]) => unknown {
  if (typeof fn !== 'function') throw new Error(`${api}: expected a page function`);
  const source = fn.toString();
  for (const name of new Set(source.match(/\bcov_[\w$]+/g) ?? [])) {
    if (!(name in win)) win[name] = () => COVERAGE_SINK;
  }
  // A method (`read(els) {…}`) is not an expression by itself.
  const method = source.startsWith('async ')
    ? `(async function ${source.slice(6)})`
    : `(function ${source})`;
  for (const candidate of [`(${source})`, method]) {
    try {
      return win.eval(candidate) as (...args: unknown[]) => unknown;
    } catch (error) {
      if ((error as Error)?.name !== 'SyntaxError') throw error;
    }
  }
  throw new Error(`${api}: the page function could not be compiled in the page`);
}

/** A test's argument, copied into the page (element handles become their elements). */
function toPage(value: unknown, win: DOMWindow): unknown {
  const element = value && typeof value === 'object' ? HANDLES.get(value) : undefined;
  if (element) return element;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new win.Date(value.getTime());
  if (Array.isArray(value)) return win.Array.from(value, (item: unknown) => toPage(item, win));
  const copy = new win.Object() as Record<string, unknown>;
  for (const [key, item] of Object.entries(value)) copy[key] = toPage(item, win);
  return copy;
}

/** A page function's result, serialised as Playwright does: nodes and functions are undefined. */
function fromPage(value: unknown, seen = new Set<object>()): unknown {
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null || typeof value !== 'object') return value;
  if ('nodeType' in value && typeof value.nodeType === 'number') return undefined;
  if (seen.has(value)) throw new Error('The page function returned a circular structure');
  const tag = Object.prototype.toString.call(value);
  if (tag === '[object Date]') return new Date((value as Date).getTime());
  if (tag === '[object RegExp]')
    return new RegExp((value as RegExp).source, (value as RegExp).flags);
  if (tag === '[object Error]') {
    return Object.assign(new Error((value as Error).message), { name: (value as Error).name });
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => fromPage(item, seen));
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = fromPage(item, seen);
    return copy;
  } finally {
    seen.delete(value);
  }
}

// ---------------------------------------------------------------------------------------
// The site (how it answers is in ./fake-site, shared with its loopback server)
// ---------------------------------------------------------------------------------------

function fetchBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  const tag = Object.prototype.toString.call(body);
  if (tag === '[object URLSearchParams]') return String(body);
  if (tag === '[object FormData]') {
    const fields = new URLSearchParams();
    for (const [name, value] of (body as FormData).entries()) {
      if (typeof value !== 'string') throw notSupported('files in a fetch body');
      fields.append(name, value);
    }
    return fields.toString();
  }
  throw notSupported('this fetch body', 'send a string, URLSearchParams or FormData');
}

/** The part of a fetch `Response` page scripts use. */
function fetchResponse(window: DOMWindow, response: FakeSiteResponse): object {
  const header = (name: string): string | undefined => response.headers[name.toLowerCase()];
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: '',
    url: response.url,
    headers: { get: (name: string) => header(name) ?? null, has: (name: string) => !!header(name) },
    text: () => window.Promise.resolve(response.body),
    json: () =>
      new window.Promise((resolve: (value: unknown) => void, reject: (e: unknown) => void) => {
        try {
          resolve(window.JSON.parse(response.body));
        } catch (error) {
          reject(error);
        }
      }),
  };
}

// ---------------------------------------------------------------------------------------
// jsdom internals the fake relies on (its self-test covers them)
// ---------------------------------------------------------------------------------------

/** jsdom's implementation object behind `window.location`. */
interface LocationImpl {
  _locationObjectNavigate(url: unknown, flags?: { replacement?: boolean }): void;
  reload(): void;
}

function locationImplOf(win: DOMWindow): { impl: LocationImpl; hrefOf(url: unknown): string } {
  const symbol = Object.getOwnPropertySymbols(win.location).find((s) => s.description === 'impl');
  const impl = symbol
    ? (win.location as unknown as Record<symbol, LocationImpl | undefined>)[symbol]
    : undefined;
  const href = impl && Object.getOwnPropertyDescriptor(Object.getPrototypeOf(impl), 'href')?.get;
  if (!impl || !href || typeof impl._locationObjectNavigate !== 'function') {
    throw new Error('fake browser: cannot hook window.location in this jsdom; see fake-browser.ts');
  }
  return { impl, hrefOf: (url) => String(href.call({ _url: url })) };
}

/** Serves a page's scripts and stylesheets from the site, never from the network. */
class SiteResourceLoader extends ResourceLoader {
  constructor(
    private readonly load: (url: string, options: FetchOptions) => Promise<Buffer> | null
  ) {
    super();
  }

  fetch(url: string, options: FetchOptions): ReturnType<ResourceLoader['fetch']> {
    if (url.startsWith('data:')) return super.fetch(url, options);
    const promise = this.load(url, options);
    return promise && Object.assign(promise, { abort: () => undefined });
  }
}

// ---------------------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------------------

interface Shared {
  site: FakeBrowserSite;
  requests: FakeRequestRecord[];
  pageErrors: string[];
  cap: number;
}

/** What a locator or element handle acts on. */
interface Target {
  description: string;
  resolve(api: string): Element[];
}

interface NavigationRequest {
  method: string;
  url: URL;
  body?: string;
}

type WaitResult<T> = { value: T } | { waiting: string };

interface RoleOptions {
  name?: TextMatch;
  exact?: boolean;
  includeHidden?: boolean;
  level?: number;
  checked?: boolean;
  disabled?: boolean;
  selected?: boolean;
  expanded?: boolean;
  pressed?: boolean;
}

interface FilterOptions {
  hasText?: TextMatch;
  hasNotText?: TextMatch;
  has?: object;
  hasNot?: object;
  visible?: boolean;
}

interface ActionOptions {
  timeout?: number;
  force?: boolean;
  trial?: boolean;
}

class Interrupted extends Error {}

/** Opens a page: about:blank until `goto`. `onClose` runs once, when it closes. */
function openPage(shared: Shared, timeoutMs: number | undefined, onClose: () => void): object {
  const errors: string[] = [];
  const recordError = (message: string): void => {
    errors.push(message);
    shared.pageErrors.push(message);
  };
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error: Error & { type?: string; detail?: unknown }) => {
    // The navigations jsdom does not implement are the ones the fake does.
    const handled = /^Not implemented: (navigation|HTMLFormElement\.prototype\.requestSubmit)/;
    if (error.type === 'not implemented' && handled.test(error.message)) return;
    recordError(error.detail ? messageOf(error.detail) : error.message);
  });
  const loader = new SiteResourceLoader((url, { element, referrer }) => {
    const tag = element?.localName;
    const resourceType: FakeResourceType =
      tag === 'script' ? 'script' : tag === 'link' ? 'stylesheet' : 'other';
    const target = new URL(url);
    if (!referrer || target.origin !== new URL(referrer).origin) {
      shared.requests.push({ resourceType, method: 'GET', url, status: null });
      return null;
    }
    try {
      const response = load({ method: 'GET', url: target }, resourceType);
      if (response.status >= 400) return Promise.reject(new Error(`HTTP ${response.status}`));
      return Promise.resolve(Buffer.from(response.body));
    } catch (error) {
      return Promise.reject(error);
    }
  });

  let dom = new JSDOM('', { runScripts: 'dangerously', virtualConsole });
  /** The window whose page scripts may navigate: the newest, even while it is being parsed. */
  let activeWindow: DOMWindow = dom.window;
  let closed = false;
  let lastUrl = 'about:blank';
  let defaultTimeout = timeoutMs;
  let navigationTimeout: number | undefined;
  let navigationId = 0;
  let navigationsStarted = 0;
  /** The latest navigation: settles once its page is in, or it failed (recorded). */
  let navigation: Promise<void> = Promise.resolve();
  /** A text field `fill` changed: it gets `change` when focus moves on. */
  let pendingChange: { el: HTMLInputElement; valueAtFocus: string } | undefined;

  const win = (): DOMWindow => dom.window;
  const doc = (): Document => dom.window.document;
  const currentUrl = (): string => (closed ? lastUrl : dom.window.location.href);

  function assertOpen(api: string): void {
    if (closed) throw new Error(`${api}: ${CLOSED}`);
  }

  function close(): void {
    if (closed) return;
    lastUrl = dom.window.location.href;
    closed = true;
    dom.window.close();
    onClose();
  }

  /** Retries `attempt` until it has a value, the page closes or time runs out. */
  async function poll<T>(
    api: string,
    timeout: number | undefined,
    attempt: () => WaitResult<T>,
    kind: 'action' | 'navigation' = 'action'
  ): Promise<T> {
    const fallback = kind === 'navigation' ? (navigationTimeout ?? defaultTimeout) : defaultTimeout;
    const wanted = timeout ?? fallback;
    const ms = wanted ? Math.min(wanted, shared.cap) : shared.cap;
    const deadline = Date.now() + ms;
    for (;;) {
      assertOpen(api);
      const result = attempt();
      if ('value' in result) return result.value;
      if (Date.now() >= deadline) throw timeoutError(api, ms, result.waiting, errors);
      await sleep(POLL_MS);
    }
  }

  // ---- loading pages from the site ----

  /** Asks the site, following redirects, and records every request. */
  function load(request: NavigationRequest, resourceType: FakeResourceType): FakeSiteResponse {
    let current = request;
    for (let hops = 0; ; hops++) {
      const response = answerFakeSite(shared.site, { ...current, resourceType });
      shared.requests.push({
        resourceType,
        method: current.method,
        url: current.url.href,
        ...(current.body !== undefined ? { body: current.body } : {}),
        status: response.status,
      });
      const location = REDIRECTS.has(response.status) ? response.headers.location : undefined;
      if (!location) return response;
      if (hops >= MAX_REDIRECTS) throw new Error(`net::ERR_TOO_MANY_REDIRECTS at ${request.url}`);
      const keep = response.status === 307 || response.status === 308;
      current = {
        method: keep ? current.method : 'GET',
        url: new URL(location, current.url),
        body: keep ? current.body : undefined,
      };
    }
  }

  /** Loads the next page and settles once it is in. A later navigation interrupts this one. */
  function startNavigation(
    request: NavigationRequest,
    byScript: boolean
  ): Promise<FakeSiteResponse> {
    const id = ++navigationId;
    navigationsStarted++;
    const interrupted = (): boolean => closed || id !== navigationId;
    const run = (async (): Promise<FakeSiteResponse> => {
      await tick();
      if (interrupted()) throw new Interrupted(`Navigation to "${request.url}" was interrupted`);
      const response = load(request, 'document');
      if (interrupted()) throw new Interrupted(`Navigation to "${request.url}" was interrupted`);
      commit(response);
      return response;
    })();
    navigation = run.then(
      () => undefined,
      (error: unknown) => {
        if (byScript && !(error instanceof Interrupted)) recordError(messageOf(error));
      }
    );
    return run;
  }

  /** Replaces the document with the site's answer; its scripts run as it is parsed. */
  function commit(response: FakeSiteResponse): void {
    dom.window.close();
    pendingChange = undefined;
    dom = new JSDOM(response.body, {
      url: response.url,
      contentType: 'text/html',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      resources: loader,
      virtualConsole,
      beforeParse: install,
    });
  }

  /** Runs `run`, then waits for a navigation it started to bring in the next page. */
  async function act(api: string, run: () => void): Promise<void> {
    assertOpen(api);
    const before = navigationsStarted;
    run();
    await tick();
    if (navigationsStarted !== before) await navigation;
  }

  // ---- what jsdom does not do for a page: navigate, submit forms, fetch ----

  function install(window: DOMWindow): void {
    activeWindow = window;
    const navigate = (request: NavigationRequest): void => {
      if (window !== activeWindow || closed) return;
      startNavigation(request, true).catch(() => undefined);
    };
    const unsupported = (what: string): void => recordError(notSupported(what).message);
    const sameDocument = (url: URL): boolean =>
      url.hash !== '' && url.href.split('#')[0] === window.location.href.split('#')[0];

    const submit = (form: HTMLFormElement, submitter: HTMLElement | null): void => {
      const pick = (submitterAttr: string, formAttr: string): string | null =>
        submitter?.getAttribute(submitterAttr) ?? form.getAttribute(formAttr);
      const method = (pick('formmethod', 'method') ?? 'get').toLowerCase();
      if (method === 'dialog') return;
      const target = pick('formtarget', 'target');
      if (target && !/^_(self|top|parent)$/i.test(target)) {
        return unsupported(`forms with target="${target}"`);
      }
      const action = pick('formaction', 'action') || window.location.href;
      const url = new URL(action, form.ownerDocument.baseURI);
      const fields = new URLSearchParams();
      for (const [name, value] of new window.FormData(form, submitter ?? undefined).entries()) {
        if (typeof value !== 'string') return unsupported('file inputs in forms');
        fields.append(name, value);
      }
      if (method === 'post') return navigate({ method: 'POST', url, body: fields.toString() });
      url.search = fields.toString();
      navigate({ method: 'GET', url });
    };

    window.addEventListener(
      'submit',
      (event: Event) => {
        const submitter = (event as SubmitEvent).submitter;
        // After every listener: a page script may still prevent it.
        queueMicrotask(() => {
          if (!event.defaultPrevented) submit(event.target as HTMLFormElement, submitter);
        });
      },
      true
    );
    window.HTMLFormElement.prototype.submit = function submitForm(this: HTMLFormElement) {
      submit(this, null);
    };

    window.addEventListener(
      'click',
      (event: Event) => {
        const link = (event.target as Element | null)?.closest?.('a[href], area[href]');
        if (!link) return;
        queueMicrotask(() => {
          if (event.defaultPrevented || link.hasAttribute('download')) return;
          const target = link.getAttribute('target');
          if (target && !/^_(self|top|parent)$/i.test(target)) {
            return unsupported(`links with target="${target}"`);
          }
          const url = new URL((link as HTMLAnchorElement).href);
          // jsdom itself handles javascript: URLs and moving within the page.
          if (url.protocol !== 'javascript:' && !sameDocument(url))
            navigate({ method: 'GET', url });
        });
      },
      true
    );

    const { impl, hrefOf } = locationImplOf(window);
    const original: LocationImpl['_locationObjectNavigate'] =
      Object.getPrototypeOf(impl)._locationObjectNavigate;
    impl._locationObjectNavigate = (record, flags) => {
      const url = new URL(hrefOf(record));
      if (url.protocol === 'javascript:' || sameDocument(url)) {
        return original.call(impl, record, flags);
      }
      navigate({ method: 'GET', url });
    };
    impl.reload = () => navigate({ method: 'GET', url: new URL(window.location.href) });

    // Nothing reaches the network: fetch goes to the site, and the rest refuses.
    for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource']) {
      const refused = function refused(): never {
        throw new window.Error(notSupported(name, 'page scripts can use fetch').message);
      };
      Object.defineProperty(window, name, { value: refused, configurable: true, writable: true });
    }
    const fakeFetch = (input: unknown, init: { method?: string; body?: unknown } = {}): unknown =>
      new window.Promise((resolve: (value: unknown) => void, reject: (e: unknown) => void) => {
        let request: NavigationRequest;
        try {
          request = {
            method: (init.method ?? 'GET').toUpperCase(),
            url: new URL(String(input), window.location.href),
            body: fetchBody(init.body),
          };
        } catch (error) {
          reject(new window.TypeError(messageOf(error)));
          return;
        }
        setImmediate(() => {
          if (window !== activeWindow || closed) return; // the page has gone: no answer
          try {
            resolve(fetchResponse(window, load(request, 'fetch')));
          } catch (error) {
            reject(new window.TypeError(`Failed to fetch: ${messageOf(error)}`));
          }
        });
      });
    Object.defineProperty(window, 'fetch', {
      value: fakeFetch,
      configurable: true,
      writable: true,
    });
  }

  // ---- input ----

  const fire = (el: Element, type: string): boolean =>
    el.dispatchEvent(new el.ownerDocument.defaultView!.Event(type, { bubbles: true }));

  /** Fires `change` on the text field `fill` changed, as a browser does when it loses focus. */
  function commitChange(): void {
    const pending = pendingChange;
    pendingChange = undefined;
    if (pending?.el.isConnected && pending.el.value !== pending.valueAtFocus) {
      fire(pending.el, 'change');
    }
  }

  /** Focuses `el`, committing a change to another field first. */
  function moveFocus(el: Element): void {
    if (pendingChange && pendingChange.el !== el) commitChange();
    (el as HTMLElement).focus?.();
  }

  function clickElement(el: Element): void {
    const view = el.ownerDocument.defaultView!;
    const mouse = (type: string): boolean =>
      el.dispatchEvent(
        new view.MouseEvent(type, { bubbles: true, cancelable: true, composed: true })
      );
    mouse('mousedown');
    moveFocus(el);
    mouse('mouseup');
    if (typeof (el as HTMLElement).click === 'function') (el as HTMLElement).click();
    else mouse('click');
  }

  /** What Enter does: activate a button or link, or submit the field's form. */
  function pressEnter(el: Element): void {
    const type = (el as HTMLInputElement).type;
    const isButton = el.localName === 'input' && /^(submit|button|reset|image)$/.test(type);
    if (isButton || /^(button|a|area)$/.test(el.localName)) {
      (el as HTMLElement).click();
      return;
    }
    const form = (el as HTMLInputElement).form;
    if (el.localName !== 'input' || !form) return;
    commitChange(); // Enter commits the field's value, as in a browser
    const controls = Array.from(form.elements);
    const submitButton = controls.find(
      (c) =>
        (c.localName === 'button' && (c as HTMLButtonElement).type === 'submit') ||
        (c.localName === 'input' && /^(submit|image)$/.test((c as HTMLInputElement).type))
    ) as HTMLButtonElement | undefined;
    if (submitButton) {
      if (!submitButton.disabled) submitButton.click();
      return;
    }
    const fields = controls.filter(
      (c) => c.localName === 'input' && !NOT_FILLABLE.test((c as HTMLInputElement).type)
    );
    if (fields.length <= 1) form.requestSubmit();
  }

  async function runPageFunction(
    api: string,
    fn: unknown,
    args: unknown[],
    arg: unknown
  ): Promise<unknown> {
    assertOpen(api);
    const window = win();
    const compiled = compilePageFunction(window, api, fn);
    let result: unknown;
    try {
      result = await compiled(...args, toPage(arg, window));
    } catch (error) {
      throw new Error(`${api}: ${messageOf(error)}`, { cause: error });
    }
    return fromPage(result);
  }

  // ---- the read and action methods of locators and element handles ----

  function actionsFor(prefix: string, target: Target): Record<Action | 'clear', unknown> {
    type Check = [state: string, passes: (el: Element) => boolean];
    const VISIBLE: Check = ['visible', isVisible];
    const ENABLED: Check = ['enabled', (el) => !isDisabled(el)];

    /** The one element, now (or none). More than one is a strict mode violation. */
    const one = (api: string): Element | undefined => {
      const elements = target.resolve(api);
      if (elements.length > 1) throw strictModeViolation(api, target.description, elements.length);
      return elements[0];
    };

    /** The one element, once it passes `checks`. */
    const element = (api: string, timeout?: number, checks: Check[] = [], force = false) =>
      poll(api, timeout, (): WaitResult<Element> => {
        const el = one(api);
        if (!el) return { waiting: `waiting for ${target.description}` };
        const failed = force ? undefined : checks.find(([, passes]) => !passes(el));
        if (failed) return { waiting: `waiting for ${target.description} to be ${failed[0]}` };
        return { value: el };
      });

    const read =
      <T>(method: string, get: (el: Element, api: string) => T) =>
      async (options?: { timeout?: number }): Promise<T> => {
        const api = `${prefix}.${method}`;
        allowOptions(api, options, ['timeout']);
        return get(await element(api, options?.timeout), api);
      };

    const isChecked = (el: Element, api: string): boolean | 'mixed' => {
      const state = checkedState(el);
      if (state === undefined) throw new Error(`${api}: Error: Not a checkbox or radio button`);
      return state;
    };

    const setChecked = async (method: string, checked: boolean, options: ActionOptions = {}) => {
      const api = `${prefix}.${method}`;
      allowOptions(api, options, ['timeout', 'force', 'noWaitAfter', 'trial']);
      const el = await element(api, options.timeout, [VISIBLE, ENABLED], options.force);
      if (isChecked(el, api) === checked) return;
      if (!checked && (el as HTMLInputElement).type === 'radio') {
        throw new Error(`${api}: Error: Cannot uncheck radio button`);
      }
      if (options.trial) return;
      await act(api, () => clickElement(el));
      if (checkedState(el) !== checked) {
        throw new Error(`${api}: Error: Clicking the checkbox did not change its state`);
      }
    };

    const fill = async (method: string, value: string, options: ActionOptions = {}) => {
      const api = `${prefix}.${method}`;
      allowOptions(api, options, ['timeout', 'force', 'noWaitAfter']);
      const el = await element(api, options.timeout, [VISIBLE, ENABLED], options.force);
      const input = el as HTMLInputElement;
      if (el.localName === 'input' && NOT_FILLABLE.test(input.type)) {
        throw new Error(`${api}: Error: Input of type "${input.type}" cannot be filled`);
      }
      if (!/^(input|textarea)$/.test(el.localName) && !isContentEditable(el)) {
        throw new Error(
          `${api}: Error: Element is not an <input>, <textarea> or [contenteditable] element`
        );
      }
      if (!options.force) await element(api, options.timeout, [['editable', isEditable]]);
      await act(api, () => {
        moveFocus(el);
        if (isContentEditable(el)) {
          el.textContent = value;
          fire(el, 'input');
        } else if (SET_VALUE_TYPES.has(input.type)) {
          input.value = value;
          if (value && input.value !== value) throw new Error(`${api}: Error: Malformed value`);
          fire(el, 'input');
          fire(el, 'change');
        } else {
          if (pendingChange?.el !== input) pendingChange = { el: input, valueAtFocus: input.value };
          input.value = value;
          fire(el, 'input');
        }
      });
    };

    const selectOption = async (
      values: string | SelectOptionValue | Array<string | SelectOptionValue> | null,
      options: ActionOptions = {}
    ): Promise<string[]> => {
      const api = `${prefix}.selectOption`;
      allowOptions(api, options, ['timeout', 'force', 'noWaitAfter']);
      const el = await element(api, options.timeout, [VISIBLE, ENABLED], options.force);
      if (el.localName !== 'select')
        throw new Error(`${api}: Error: Element is not a <select> element`);
      const select = el as HTMLSelectElement;
      const wanted = values === null ? [] : Array.isArray(values) ? values : [values];
      if (!select.multiple && wanted.length > 1) {
        throw new Error(`${api}: Error: Non-multiple select can't have multiple selected values`);
      }
      const matches = (
        option: HTMLOptionElement,
        index: number,
        want: string | SelectOptionValue
      ) =>
        typeof want === 'string'
          ? option.value === want || option.label === want
          : (want.value === undefined || option.value === want.value) &&
            (want.label === undefined || option.label === want.label) &&
            (want.index === undefined || index === want.index);
      // Options a page script adds later count: wait for every one asked for.
      const chosen = await poll(api, options.timeout, (): WaitResult<HTMLOptionElement[]> => {
        const all = Array.from(select.options);
        const found = wanted.map((want) => all.find((option, i) => matches(option, i, want)));
        if (found.every(Boolean)) return { value: found as HTMLOptionElement[] };
        return { waiting: `waiting for ${target.description} to have options ${show(wanted)}` };
      });
      await act(api, () => {
        moveFocus(select);
        for (const option of Array.from(select.options)) option.selected = chosen.includes(option);
        fire(select, 'input');
        fire(select, 'change');
      });
      return chosen.map((option) => option.value);
    };

    return {
      textContent: read('textContent', (el) => el.textContent),
      innerText: read('innerText', innerTextOf),
      innerHTML: read('innerHTML', (el) => el.innerHTML),
      inputValue: read('inputValue', (el, api) => {
        if (!/^(input|textarea|select)$/.test(el.localName)) {
          throw new Error(`${api}: Error: Node is not an <input>, <textarea> or <select> element`);
        }
        return (el as HTMLInputElement).value;
      }),
      isEnabled: read('isEnabled', (el) => !isDisabled(el)),
      isDisabled: read('isDisabled', isDisabled),
      isChecked: read('isChecked', (el, api) => isChecked(el, api) === true),
      async getAttribute(name: string, options?: { timeout?: number }) {
        const api = `${prefix}.getAttribute`;
        allowOptions(api, options, ['timeout']);
        return (await element(api, options?.timeout)).getAttribute(name);
      },
      // Like Playwright's, these answer at once, without waiting.
      async isVisible(options?: { timeout?: number }) {
        allowOptions(`${prefix}.isVisible`, options, ['timeout']);
        assertOpen(`${prefix}.isVisible`);
        const el = one(`${prefix}.isVisible`);
        return el ? isVisible(el) : false;
      },
      async isHidden(options?: { timeout?: number }) {
        allowOptions(`${prefix}.isHidden`, options, ['timeout']);
        assertOpen(`${prefix}.isHidden`);
        const el = one(`${prefix}.isHidden`);
        return el ? !isVisible(el) : true;
      },
      async click(options: ActionOptions = {}) {
        const api = `${prefix}.click`;
        allowOptions(api, options, ['timeout', 'force', 'noWaitAfter', 'trial']);
        const el = await element(api, options.timeout, [VISIBLE, ENABLED], options.force);
        if (!options.trial) await act(api, () => clickElement(el));
      },
      fill: (value: string, options?: ActionOptions) => fill('fill', value, options),
      clear: (options?: ActionOptions) => fill('clear', '', options),
      async press(key: string, options?: { timeout?: number }) {
        const api = `${prefix}.press`;
        allowOptions(api, options, ['timeout', 'noWaitAfter', 'delay']);
        if (!/^(Enter|Escape|Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/.test(key)) {
          throw notSupported(`${api}('${key}')`, 'use fill to enter text');
        }
        const el = await element(api, options?.timeout);
        await act(api, () => {
          moveFocus(el);
          const view = el.ownerDocument.defaultView!;
          const init = { key, code: key, bubbles: true, cancelable: true };
          const proceed = el.dispatchEvent(new view.KeyboardEvent('keydown', init));
          if (proceed && key === 'Enter') pressEnter(el);
          el.dispatchEvent(new view.KeyboardEvent('keyup', init));
        });
      },
      selectOption,
      check: (options?: ActionOptions) => setChecked('check', true, options),
      uncheck: (options?: ActionOptions) => setChecked('uncheck', false, options),
      async evaluate(fn: unknown, arg?: unknown) {
        const el = await element(`${prefix}.evaluate`);
        return runPageFunction(`${prefix}.evaluate`, fn, [el], arg);
      },
    };
  }

  // ---- queries ----

  function cssQuery(selector: string): Query {
    const css = selector.startsWith('css=') ? selector.slice(4) : selector;
    const extension =
      /^((xpath|text|id|data-testid|data-test-id|data-test)=|internal:|\/\/|\.\.)|>>|:has-text\(|:text(-is|-matches)?\(|:visible\b|:nth-match\(|:(right-of|left-of|above|below|near)\(/;
    if (extension.test(css)) {
      throw notSupported(`selector "${selector}"`, 'use CSS, the getBy… methods or filter');
    }
    return (roots) => inOrder(roots.flatMap((root) => Array.from(root.querySelectorAll(css))));
  }

  function textQuery(match: TextMatch, exact = false): Query {
    const matches = (el: Element): boolean =>
      !NOT_RENDERED.has(el.localName) && matchesText(textOf(el), match, exact);
    // The smallest elements with the text: none of their children has it by itself.
    return (roots) =>
      descendants(roots).filter((el) => matches(el) && !Array.from(el.children).some(matches));
  }

  function roleQuery(role: string, options: RoleOptions): Query {
    const aria = (el: Element, name: string): boolean => el.getAttribute(name) === 'true';
    const selected = (el: Element): boolean =>
      (el as HTMLOptionElement).selected === true || aria(el, 'aria-selected');
    const wanted = <T>(option: T | undefined, actual: () => T): boolean =>
      option === undefined || actual() === option;
    return (roots) =>
      descendants(roots).filter(
        (el) =>
          roleOf(el) === role &&
          (options.includeHidden || !hiddenForAria(el)) &&
          (options.name === undefined ||
            matchesText(accessibleName(el), options.name, options.exact)) &&
          wanted(options.level, () => headingLevel(el)) &&
          wanted(options.checked, () => checkedState(el) as boolean) &&
          wanted(options.disabled, () => isDisabled(el)) &&
          wanted(options.selected, () => selected(el)) &&
          wanted(options.expanded, () => aria(el, 'aria-expanded')) &&
          wanted(options.pressed, () => aria(el, 'aria-pressed'))
      );
  }

  function specOf(api: string, locator: unknown): LocatorSpec {
    const spec = locator && typeof locator === 'object' ? LOCATORS.get(locator) : undefined;
    if (!spec) throw new Error(`${api}: expected a locator of the same fake browser`);
    return spec;
  }

  function filterStep(api: string, options: FilterOptions): (nodes: ParentNode[]) => ParentNode[] {
    const has = options.has && specOf(api, options.has);
    const hasNot = options.hasNot && specOf(api, options.hasNot);
    return (nodes) =>
      inOrder(nodes).filter(
        (el) =>
          (options.hasText === undefined || matchesText(textOf(el), options.hasText)) &&
          (options.hasNotText === undefined || !matchesText(textOf(el), options.hasNotText)) &&
          (!has || has.query([el]).length > 0) &&
          (!hasNot || hasNot.query([el]).length === 0) &&
          (options.visible === undefined || isVisible(el) === options.visible)
      );
  }

  /** The `getBy…` methods, on the page or within a locator. */
  function getters(make: (label: string, query: Query) => object): Record<GetBy, unknown> {
    const by =
      (attribute: string, match: TextMatch, exact: boolean | undefined): Query =>
      (roots) =>
        descendants(roots).filter((el) => {
          const value = el.getAttribute(attribute);
          return value !== null && matchesText(value, match, exact);
        });
    return {
      getByRole(role: string, options: RoleOptions = {}) {
        allowOptions('getByRole', options, [
          'name',
          'exact',
          'includeHidden',
          'level',
          'checked',
          'disabled',
          'selected',
          'expanded',
          'pressed',
        ]);
        const shown = Object.keys(options).length ? `, ${show(options)}` : '';
        return make(`getByRole(${show(role)}${shown})`, roleQuery(role, options));
      },
      getByText(text: TextMatch, options: { exact?: boolean } = {}) {
        allowOptions('getByText', options, ['exact']);
        return make(`getByText(${show(text)})`, textQuery(text, options.exact));
      },
      getByLabel(text: TextMatch, options: { exact?: boolean } = {}) {
        allowOptions('getByLabel', options, ['exact']);
        const query: Query = (roots) =>
          descendants(roots).filter((el) =>
            labelTexts(el).some((label) => matchesText(label, text, options.exact))
          );
        return make(`getByLabel(${show(text)})`, query);
      },
      getByPlaceholder(text: TextMatch, options: { exact?: boolean } = {}) {
        allowOptions('getByPlaceholder', options, ['exact']);
        return make(`getByPlaceholder(${show(text)})`, by('placeholder', text, options.exact));
      },
      getByTestId(testId: TextMatch) {
        // A test id matches exactly (a RegExp, as written).
        return make(`getByTestId(${show(testId)})`, by('data-testid', testId, true));
      },
    };
  }

  // ---- facades ----

  function locatorFor(spec: LocatorSpec): object {
    const name = spec.description ? 'locator' : 'page';
    const child = (label: string, step: (nodes: ParentNode[]) => ParentNode[]): object =>
      locatorFor({
        query: (roots) => step(spec.query(roots)),
        description: spec.description ? `${spec.description}.${label}` : label,
      });
    const all = (api: string): Element[] => {
      assertOpen(api);
      return inOrder(spec.query([doc()]));
    };
    const nth = (index: number, label: string): object =>
      child(label, (nodes) => {
        const elements = inOrder(nodes);
        const el = elements[index < 0 ? elements.length + index : index];
        return el ? [el] : [];
      });
    const combine = (method: 'and' | 'or', other: unknown): object => {
      const theirs = specOf(`locator.${method}`, other);
      return locatorFor({
        query: (roots) => {
          const mine = spec.query(roots);
          if (method === 'or') return inOrder([...mine, ...theirs.query(roots)]);
          const keep = new Set(theirs.query(roots));
          return mine.filter((node) => keep.has(node));
        },
        description: `${spec.description}.${method}(${theirs.description})`,
      });
    };

    const api: Record<LocatorMethod, unknown> = {
      ...getters(child),
      ...actionsFor('locator', { description: spec.description, resolve: all }),
      locator(selectorOrLocator: string | object, options: FilterOptions = {}) {
        allowOptions(`${name}.locator`, options, ['hasText', 'hasNotText', 'has', 'hasNot']);
        const inner =
          typeof selectorOrLocator === 'string'
            ? cssQuery(selectorOrLocator)
            : specOf(`${name}.locator`, selectorOrLocator).query;
        const filter = filterStep(`${name}.locator`, options);
        const shown = Object.keys(options).length ? `, ${show(options)}` : '';
        return child(`locator(${show(selectorOrLocator)}${shown})`, (nodes) =>
          filter(inner(nodes))
        );
      },
      filter(options: FilterOptions = {}) {
        allowOptions('locator.filter', options, [
          'hasText',
          'hasNotText',
          'has',
          'hasNot',
          'visible',
        ]);
        return child(`filter(${show(options)})`, filterStep('locator.filter', options));
      },
      first: () => nth(0, 'first()'),
      last: () => nth(-1, 'last()'),
      nth: (index: number) => nth(index, `nth(${index})`),
      and: (other: object) => combine('and', other),
      or: (other: object) => combine('or', other),
      count: async () => all('locator.count').length,
      all: async () => all('locator.all').map((_el, index) => nth(index, `nth(${index})`)),
      allTextContents: async () => all('locator.allTextContents').map((el) => el.textContent ?? ''),
      allInnerTexts: async () => all('locator.allInnerTexts').map(innerTextOf),
      async waitFor(options: { state?: string; timeout?: number } = {}) {
        allowOptions('locator.waitFor', options, ['state', 'timeout']);
        const state = options.state ?? 'visible';
        if (!/^(attached|detached|visible|hidden)$/.test(state)) {
          throw new Error(
            'locator.waitFor: state: expected one of (attached|detached|visible|hidden)'
          );
        }
        await poll('locator.waitFor', options.timeout, (): WaitResult<undefined> => {
          const elements = all('locator.waitFor');
          if (elements.length > 1) {
            throw strictModeViolation('locator.waitFor', spec.description, elements.length);
          }
          const el = elements[0];
          const visible = !!el && isVisible(el);
          const done = {
            attached: !!el,
            detached: !el,
            visible,
            hidden: !visible,
          }[state as 'attached'];
          if (done) return { value: undefined };
          return { waiting: `waiting for ${spec.description} to be ${state}` };
        });
      },
      async evaluateAll(fn: unknown, arg?: unknown) {
        const elements = all('locator.evaluateAll');
        return runPageFunction('locator.evaluateAll', fn, [win().Array.from(elements)], arg);
      },
    };
    const facade = strict(Object.assign(api, { toString: () => spec.description }), 'locator');
    LOCATORS.set(facade, spec);
    return facade;
  }

  function handleFor(el: Element): object {
    const attached = (api: string): Element[] => {
      assertOpen(api);
      if (!el.isConnected || el.ownerDocument !== doc()) {
        throw new Error(`${api}: Element is not attached to the DOM`);
      }
      return [el];
    };
    const find = (api: string, selector: string): Element[] =>
      inOrder(cssQuery(selector)(attached(api)));
    // Element handles have no `clear` in Playwright.
    const actions: Partial<Record<Action | 'clear', unknown>> = actionsFor('elementHandle', {
      description: 'the element',
      resolve: attached,
    });
    delete actions.clear;
    const api: Record<HandleMethod, unknown> = {
      ...(actions as Record<Action, unknown>),
      $: async (selector: string) => {
        const [found] = find('elementHandle.$', selector);
        return found ? handleFor(found) : null;
      },
      $$: async (selector: string) => find('elementHandle.$$', selector).map(handleFor),
      async $eval(selector: string, fn: unknown, arg?: unknown) {
        const [found] = find('elementHandle.$eval', selector);
        if (!found) {
          throw new Error(
            `elementHandle.$eval: Failed to find element matching selector "${selector}"`
          );
        }
        return runPageFunction('elementHandle.$eval', fn, [found], arg);
      },
      async $$eval(selector: string, fn: unknown, arg?: unknown) {
        const found = find('elementHandle.$$eval', selector);
        return runPageFunction('elementHandle.$$eval', fn, [win().Array.from(found)], arg);
      },
      dispose: async () => undefined,
    };
    const facade = strict(api, 'elementHandle');
    HANDLES.set(facade, el);
    return facade;
  }

  function responseFor(response: FakeSiteResponse): object {
    const api: Record<ResponseMethod, unknown> = {
      status: () => response.status,
      ok: () => response.status >= 200 && response.status < 300,
      url: () => response.url,
      statusText: () => '',
      headers: () => ({ ...response.headers }),
      text: async () => response.body,
    };
    return strict(api, 'response');
  }

  // ---- the page ----

  const LOAD_STATES = /^(load|domcontentloaded|networkidle|commit)$/;

  function checkLoadState(api: string, state: string): void {
    if (!LOAD_STATES.test(state)) {
      throw new Error(`${api}: state: expected one of (load|domcontentloaded|networkidle|commit)`);
    }
  }

  /** Whether the document reached `state` (`networkidle` is `load`: the site answers at once). */
  function reached(state: string): boolean {
    const readyState = doc().readyState;
    if (state === 'commit') return true;
    return state === 'domcontentloaded' ? readyState !== 'loading' : readyState === 'complete';
  }

  async function navigateAndWait(
    api: string,
    request: NavigationRequest,
    options: { waitUntil?: string; timeout?: number }
  ): Promise<object> {
    const waitUntil = options.waitUntil ?? 'load';
    checkLoadState(api, waitUntil);
    let response: FakeSiteResponse;
    try {
      response = await startNavigation(request, false);
    } catch (error) {
      assertOpen(api);
      throw new Error(`${api}: ${messageOf(error)}`, { cause: error });
    }
    await poll(
      api,
      options.timeout,
      () => (reached(waitUntil) ? { value: true } : { waiting: `waiting for "${waitUntil}"` }),
      'navigation'
    );
    return responseFor(response);
  }

  const root = locatorFor({ query: (roots) => roots, description: '' }) as Record<
    'locator' | GetBy,
    unknown
  >;
  const firstMatch = (api: string, selector: string): Element | undefined => {
    assertOpen(api);
    return inOrder(cssQuery(selector)([doc()]))[0];
  };

  const page: Record<PageMethod, unknown> = {
    locator: root.locator,
    getByRole: root.getByRole,
    getByLabel: root.getByLabel,
    getByText: root.getByText,
    getByTestId: root.getByTestId,
    getByPlaceholder: root.getByPlaceholder,
    async goto(
      url: string,
      options: { waitUntil?: string; timeout?: number; referer?: string } = {}
    ) {
      allowOptions('page.goto', options, ['waitUntil', 'timeout', 'referer']);
      assertOpen('page.goto');
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        throw new Error(
          'page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL'
        );
      }
      return navigateAndWait('page.goto', { method: 'GET', url: target }, options);
    },
    async reload(options: { waitUntil?: string; timeout?: number } = {}) {
      allowOptions('page.reload', options, ['waitUntil', 'timeout']);
      assertOpen('page.reload');
      return navigateAndWait('page.reload', { method: 'GET', url: new URL(currentUrl()) }, options);
    },
    url: currentUrl,
    async title() {
      assertOpen('page.title');
      return doc().title;
    },
    async content() {
      assertOpen('page.content');
      return dom.serialize();
    },
    async $(selector: string) {
      const el = firstMatch('page.$', selector);
      return el ? handleFor(el) : null;
    },
    async $$(selector: string) {
      assertOpen('page.$$');
      return inOrder(cssQuery(selector)([doc()])).map(handleFor);
    },
    async $eval(selector: string, fn: unknown, arg?: unknown) {
      const el = firstMatch('page.$eval', selector);
      if (!el)
        throw new Error(`page.$eval: Failed to find element matching selector "${selector}"`);
      return runPageFunction('page.$eval', fn, [el], arg);
    },
    async $$eval(selector: string, fn: unknown, arg?: unknown) {
      assertOpen('page.$$eval');
      const elements = inOrder(cssQuery(selector)([doc()]));
      return runPageFunction('page.$$eval', fn, [win().Array.from(elements)], arg);
    },
    async evaluate(fn: unknown, arg?: unknown) {
      if (typeof fn !== 'string') return runPageFunction('page.evaluate', fn, [], arg);
      assertOpen('page.evaluate');
      try {
        return fromPage(await win().eval(fn));
      } catch (error) {
        throw new Error(`page.evaluate: ${messageOf(error)}`, { cause: error });
      }
    },
    async waitForSelector(
      selector: string,
      options: { state?: string; timeout?: number; strict?: boolean } = {}
    ) {
      const api = 'page.waitForSelector';
      allowOptions(api, options, ['state', 'timeout', 'strict']);
      const state = options.state ?? 'visible';
      if (!/^(attached|detached|visible|hidden)$/.test(state)) {
        throw new Error(`${api}: state: expected one of (attached|detached|visible|hidden)`);
      }
      const query = cssQuery(selector);
      const described = `locator(${show(selector)})`;
      const found = await poll(api, options.timeout, (): WaitResult<Element | null> => {
        const elements = inOrder(query([doc()]));
        if (options.strict && elements.length > 1) {
          throw strictModeViolation(api, described, elements.length);
        }
        const visible = elements.find(isVisible);
        if (state === 'attached' && elements[0]) return { value: elements[0] };
        if (state === 'visible' && visible) return { value: visible };
        if (state === 'detached' && !elements.length) return { value: null };
        if (state === 'hidden' && !visible) return { value: null };
        return { waiting: `waiting for ${described} to be ${state}` };
      });
      return found ? handleFor(found) : null;
    },
    async waitForURL(
      url: string | RegExp | ((url: URL) => boolean),
      options: { timeout?: number; waitUntil?: string } = {}
    ) {
      allowOptions('page.waitForURL', options, ['timeout', 'waitUntil']);
      const waitUntil = options.waitUntil ?? 'load';
      checkLoadState('page.waitForURL', waitUntil);
      const matches = urlMatcher(url);
      await poll(
        'page.waitForURL',
        options.timeout,
        (): WaitResult<undefined> =>
          matches(currentUrl()) && reached(waitUntil)
            ? { value: undefined }
            : { waiting: `waiting for navigation to ${show(url)} (at ${currentUrl()})` },
        'navigation'
      );
    },
    async waitForLoadState(state = 'load', options: { timeout?: number } = {}) {
      allowOptions('page.waitForLoadState', options, ['timeout']);
      checkLoadState('page.waitForLoadState', state);
      await poll(
        'page.waitForLoadState',
        options.timeout,
        (): WaitResult<undefined> =>
          reached(state) ? { value: undefined } : { waiting: `waiting for "${state}"` },
        'navigation'
      );
    },
    setDefaultTimeout: (ms: number) => {
      defaultTimeout = ms;
    },
    setDefaultNavigationTimeout: (ms: number) => {
      navigationTimeout = ms;
    },
    isClosed: () => closed,
    close: async () => close(),
  };

  return strict(page, 'page', PAGE_HINTS);
}

// ---------------------------------------------------------------------------------------
// The browser
// ---------------------------------------------------------------------------------------

/** Settles with `pending`, or rejects with an AbortError as soon as `signal` aborts. */
function raceAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(createAbortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** A `BrowserAutomation` whose pages come from `site` (see the top of this file). */
export function createFakeBrowser(
  site: FakeBrowserSite,
  options: FakeBrowserOptions = {}
): FakeBrowserAutomation {
  const providerId = options.providerId ?? 'test';
  const shared: Shared = {
    site,
    requests: [],
    pageErrors: [],
    cap: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  const open = new Set<() => void>();
  const oneAtATime = createLimiter(1);
  let peak = 0;
  let closing = false;
  const closingError = (): Error =>
    new BrowserUnavailableError(providerId, 'closing', 'WA Stay is closing');

  async function run<T>(fn: (page: Page) => Promise<T>, { signal, timeoutMs }: WithPageOptions) {
    if (closing) throw closingError();
    if (signal?.aborted) throw createAbortError(signal);
    let closePage = (): void => undefined;
    const forget = (): void => {
      open.delete(closePage);
    };
    const page = openPage(shared, timeoutMs, forget) as { close(): Promise<void> };
    closePage = () => void page.close();
    open.add(closePage);
    peak = Math.max(peak, open.size);
    signal?.addEventListener('abort', closePage, { once: true });
    try {
      // The one place the fake stands in for playwright-core's Page.
      return await fn(page as unknown as Page);
    } finally {
      signal?.removeEventListener('abort', closePage);
      closePage();
    }
  }

  return {
    async isAvailable(): Promise<BrowserAvailability> {
      return closing
        ? { available: false, reason: 'closing' }
        : { available: true, channel: 'chrome' };
    },
    withPage<T>(fn: (page: Page) => Promise<T>, withPageOptions: WithPageOptions = {}): Promise<T> {
      try {
        allowOptions('withPage', withPageOptions, ['signal', 'timeoutMs', 'headed']);
      } catch (error) {
        return Promise.reject(error);
      }
      const { signal } = withPageOptions;
      if (closing) return Promise.reject(closingError());
      if (signal?.aborted) return Promise.reject(createAbortError(signal));
      const pending = oneAtATime(() => run(fn, withPageOptions));
      return signal ? raceAbort(pending, signal) : pending;
    },
    async close() {
      closing = true;
      for (const closePage of [...open]) closePage();
    },
    get visits() {
      return shared.requests.filter((r) => r.resourceType === 'document').map((r) => r.url);
    },
    requests: shared.requests,
    pageErrors: shared.pageErrors,
    openPages: () => open.size,
    get peakOpenPages() {
      return peak;
    },
  };
}
