/**
 * ParkStay's campground page, `GET /search-availability/campground/?site_id=<id>`: the detail
 * its "MORE DETAILS" tab shows and the campground's notices. No JSON endpoint serves either:
 * the page is rendered on the server (`SearchAvailablityByCampground`, `views.py:1255`;
 * templates `search_availabilty_campground.html` and `…_campground_details.html`).
 *
 * - **Sections.** `#campground-details` holds an `h1` (the name), a photo carousel, the intro
 *   paragraphs (`about`), then one `h5` per section (Booking, Campsites, Facilities, Campground
 *   Rules, Fees, Your safety and health, Location) with its rich text. The intro becomes the
 *   section `INTRO_TITLE`; the name and the photos are left out (the place page has both).
 *   Each section is sanitised with the shared sanitiser, its headings under the section's own.
 * - **Notices.** Each `.round-box` of notices has one `div` per notice: an icon, whose class
 *   gives the level (`NOTICE_LEVELS`), and the text in a `span`. Other round boxes (the park
 *   alert count, the search form) have no such icon and are not notices.
 *
 * The page can come back as something else, and `readCampgroundPage` says which:
 * - the DBCA queue's waiting room (the client rejects with an `AccessGateError`);
 * - another page after redirects (`redirected`): ParkStay sends a request whose `Referer` it
 *   does not accept to `/`, then to `/search-availability/information/`;
 * - the "Oops!" page (`booking-in-progress`), shown instead while a hold is in the session;
 * - no `#campground-details` at all (`no-details`): a site closure message, or a new layout;
 * - `#campground-details` with no section in it (`no-sections`): a new layout.
 *
 * The page is parsed with sanitize-html's parser (htmlparser2), through its open, close and
 * text hooks: no other HTML library.
 */

import sanitizeHtml from 'sanitize-html';
import type {
  LocationNotice,
  LocationNoticeLevel,
  LocationSection,
} from '@shared/types/catalog.types';
import type { ProviderLogger } from '../sdk/context';
import { AccessGateError, isAbortError } from '../sdk/errors';
import { sanitizeProviderHtml } from '../sdk/html';
import type { PageResponse, ParkStayClient } from './client';
import { PARKSTAY_BASE_URL } from './constants';

/** The campground page's path. */
export const CAMPGROUND_PAGE_PATH = '/search-availability/campground/';

/** The title of the intro, which has no heading on ParkStay's page. */
export const INTRO_TITLE = 'Overview';

/** The notice icons ParkStay uses (`notice_type` 0, 1 and 2: red, orange and blue). */
export const NOTICE_LEVELS: Readonly<Record<string, LocationNoticeLevel>> = {
  'bi-exclamation-diamond-fill': 'warning',
  'bi-exclamation-triangle-fill': 'caution',
  'bi-info-circle-fill': 'info',
};

/** Why the page gave no sections. */
export type CampgroundPageProblem =
  'redirected' | 'booking-in-progress' | 'no-details' | 'no-sections';

export type CampgroundPageResult =
  | { ok: true; sections: LocationSection[]; notices: LocationNotice[] }
  | { ok: false; problem: CampgroundPageProblem };

const PROBLEMS: Record<CampgroundPageProblem, string> = {
  redirected: 'ParkStay sent the request to another page',
  'booking-in-progress': 'ParkStay showed its "Oops!" page (a booking is in progress)',
  'no-details': 'the page has no campground details (a closure, or a new layout)',
  'no-sections': 'the campground details have no sections (a new layout)',
};

// ---------------------------------------------------------------------------------------
// A small element tree
// ---------------------------------------------------------------------------------------

interface HtmlElement {
  tag: string;
  attribs: Record<string, string>;
  children: HtmlNode[];
}

/** A text node holds its text escaped as HTML (`&amp;`, `&lt;`, `&gt;`). */
type HtmlNode = HtmlElement | { text: string };

const isElement = (node: HtmlNode): node is HtmlElement => 'tag' in node;

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/**
 * `html` as an element tree, read by sanitize-html's parser with every tag and attribute
 * allowed: its hooks report each element as it opens and closes (implied closes included) and
 * each text, escaped. Script and style text never reaches the text hook.
 */
function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { tag: '#root', attribs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const top = (): HtmlElement => stack[stack.length - 1];
  sanitizeHtml(html, {
    allowedTags: false,
    allowedAttributes: false,
    // Only the hooks are used, never the output, so allowing script and style is safe here.
    allowVulnerableTags: true,
    onOpenTag: (tag, attribs) => {
      const element: HtmlElement = { tag, attribs, children: [] };
      top().children.push(element);
      stack.push(element);
    },
    onCloseTag: (tag) => {
      const at = stack.map((element) => element.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
    },
    textFilter: (text) => {
      top().children.push({ text });
      return text;
    },
  });
  return root;
}

function findAll(
  from: HtmlElement,
  test: (element: HtmlElement) => boolean,
  found: HtmlElement[] = []
): HtmlElement[] {
  for (const child of from.children) {
    if (!isElement(child)) continue;
    if (test(child)) found.push(child);
    findAll(child, test, found);
  }
  return found;
}

const classesOf = (element: HtmlElement): string[] =>
  (element.attribs.class ?? '').split(/\s+/).filter(Boolean);

const unescapeText = (text: string): string =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The element's text, unescaped, with runs of white space as one space. */
function textOf(node: HtmlNode): string {
  const raw = (n: HtmlNode): string =>
    isElement(n) ? n.children.map(raw).join('') : unescapeText(n.text);
  return raw(node).replace(/\s+/g, ' ').trim();
}

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Nodes back to HTML, for the sanitiser. */
function serialize(nodes: readonly HtmlNode[]): string {
  return nodes
    .map((node) => {
      if (!isElement(node)) return node.text;
      const attribs = Object.entries(node.attribs)
        .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
        .join('');
      if (VOID_TAGS.has(node.tag)) return `<${node.tag}${attribs}>`;
      return `<${node.tag}${attribs}>${serialize(node.children)}</${node.tag}>`;
    })
    .join('');
}

/** Whether sanitised HTML has any text, or an image. */
const hasContent = (html: string): boolean =>
  /\S/.test(html.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ')) || /<img\b/.test(html);

// ---------------------------------------------------------------------------------------
// Reading the page
// ---------------------------------------------------------------------------------------

/** Before the first section: the name, the photo carousel and line breaks, all left out. */
function isIntroChrome(element: HtmlElement): boolean {
  return (
    element.tag === 'h1' ||
    element.tag === 'br' ||
    classesOf(element).includes('carousel') ||
    element.attribs.id === 'carouselExampleCaptions'
  );
}

/** The sections of `#campground-details`: the intro, then one per `h5`, in the page's order. */
function campgroundSections(details: HtmlElement): LocationSection[] {
  const sections: LocationSection[] = [];
  let title = INTRO_TITLE;
  let intro = true;
  let nodes: HtmlNode[] = [];
  const finish = (): void => {
    const html = sanitizeProviderHtml(serialize(nodes), PARKSTAY_BASE_URL, { topHeading: 4 })
      // The template wraps rich text in a `p` of its own, which leaves empty ones around it.
      .replace(/<p>\s*<\/p>/g, '')
      .trim();
    if (title && hasContent(html)) sections.push({ title, html });
  };
  for (const node of details.children) {
    if (isElement(node) && node.tag === 'h5') {
      finish();
      title = textOf(node);
      intro = false;
      nodes = [];
    } else if (!(intro && isElement(node) && isIntroChrome(node))) {
      nodes.push(node);
    }
  }
  finish();
  return sections;
}

/** The notices in the page's round boxes, in its order. */
function campgroundNotices(root: HtmlElement): LocationNotice[] {
  const levelOf = (node: HtmlNode): LocationNoticeLevel | undefined =>
    isElement(node) && node.tag === 'i'
      ? classesOf(node)
          .map((name) => NOTICE_LEVELS[name])
          .find(Boolean)
      : undefined;
  const notices: LocationNotice[] = [];
  const seen = new Set<HtmlElement>();
  for (const box of findAll(root, (element) => classesOf(element).includes('round-box'))) {
    for (const item of findAll(box, (element) => element.children.some(levelOf))) {
      if (seen.has(item)) continue;
      seen.add(item);
      const level = item.children.map(levelOf).find(Boolean);
      const span = item.children.find((child) => isElement(child) && child.tag === 'span');
      const text = span ? textOf(span) : '';
      if (level && text) notices.push({ level, text });
    }
  }
  return notices;
}

/** The final URL's path, or undefined when it is not a URL. */
function pathOf(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}

/**
 * The campground page's sections and notices, or why it has none. A page whose final URL is
 * not the campground page's is `redirected`, whatever it shows.
 */
export function readCampgroundPage(page: Pick<PageResponse, 'url' | 'body'>): CampgroundPageResult {
  if (pathOf(page.url) !== CAMPGROUND_PAGE_PATH) return { ok: false, problem: 'redirected' };
  const root = parseHtml(page.body);
  const [details] = findAll(root, (element) => element.attribs.id === 'campground-details');
  if (!details) {
    const oops = findAll(root, (element) => element.tag === 'h1').some(
      (h1) => textOf(h1) === 'Oops!'
    );
    return { ok: false, problem: oops ? 'booking-in-progress' : 'no-details' };
  }
  const sections = campgroundSections(details);
  if (sections.length === 0) return { ok: false, problem: 'no-sections' };
  return { ok: true, sections, notices: campgroundNotices(root) };
}

/** An error's message with any query string left out (logs never carry the URL's query). */
const withoutQueries = (message: string): string => message.replace(/\?[^\s'"]*/g, '');

/**
 * Fetches and reads campground `externalId`'s page. Resolves with its sections and notices,
 * or with undefined (the reason logged, with no query or cookie) when the page could not be
 * read. Only an abort rejects.
 */
export async function fetchCampgroundPage(
  client: ParkStayClient,
  externalId: string,
  logger: ProviderLogger,
  signal?: AbortSignal
): Promise<{ sections: LocationSection[]; notices: LocationNotice[] } | undefined> {
  let reason: string;
  try {
    const page = await client.getPage(CAMPGROUND_PAGE_PATH, {
      query: { site_id: externalId },
      signal,
    });
    const result = readCampgroundPage(page);
    if (result.ok) return { sections: result.sections, notices: result.notices };
    reason = PROBLEMS[result.problem];
    if (result.problem === 'redirected') reason += ` (${pathOf(page.url) ?? 'not a URL'})`;
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error;
    reason =
      error instanceof AccessGateError
        ? 'the DBCA queue answered'
        : withoutQueries(error instanceof Error ? error.message : String(error));
  }
  logger.warn(
    `ParkStay campground ${externalId}: no details from ${CAMPGROUND_PAGE_PATH}: ${reason}`
  );
  return undefined;
}
