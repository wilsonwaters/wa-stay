/**
 * Stay Rottnest's results page (`GET /rates-room1`), read for one stay: every room type on the
 * island, each free for the whole stay (with its price) or not. The page is rendered on the
 * server (P3's booking engine; Vue only decorates it), so its HTML is the only source
 * (`ai-state/research/rottnest-booking-flow.md` §11, from the stakeholder's capture).
 *
 * - **A room type** is one `div.room-and-rates` card. Its facts are attributes:
 *   - `room-calendar-root`: its code, e.g. `GPV04`;
 *   - `data-group`: its precinct;
 *   - `data-location-type`: `self-contained`, `hostel-dorms` or `campground`;
 *   - `data-sleeps`, `data-bedrooms`.
 *   A card the person's filters hide in their browser (`data-filtered-reasons`) is still a room
 *   type: filters are the browser's, and one search answers for all of them.
 * - **Free or not.** A card with the class `unavailable` ("Unavailable on your dates") is not
 *   free. Any other card is free for the stay when it shows a price (`span.currency-symbol`,
 *   "from $1,074.00", the cheapest rate for the whole stay); one that shows none is not read as
 *   free (`price` undefined).
 * - **Rates.** Each rate's button names it in its `data-target` (`#RIA25-GPV04`): `RIA25` (25%
 *   deposit), `CAMPING`, `HOSTS`. The rate's "Book" button posts to the booking step
 *   (`/details/…`), which nothing in WA Stay reads, keeps or opens.
 * - **Nothing else** is read: no photo, description, script or analytics.
 *
 * A page with no card at all (a redesign, an error page) reads as `undefined`, never as
 * "nothing free". The page is parsed with sanitize-html's parser (htmlparser2), through its
 * open, close and text hooks: no other HTML library.
 */

import sanitizeHtml from 'sanitize-html';
import type { RottnestLocationType } from './precincts';

export interface ResultsCard {
  /** The room type's code (`room-calendar-root`). */
  code: string;
  /** Its precinct (`data-group`); NaN when the page gives none. */
  group: number;
  locationType?: RottnestLocationType;
  /** The most people it sleeps (`data-sleeps`); undefined when the page gives no number. */
  sleeps?: number;
  bedrooms?: number;
  /** RIA's name for it. */
  name: string;
  /** The card is marked unavailable for the stay. */
  unavailable: boolean;
  /** The whole stay's price in dollars ("from $X"), for a card not marked unavailable. */
  price?: number;
  /** Its rates' codes, in the page's order: `RIA25`, `CAMPING`, `HOSTS`. */
  rates: string[];
}

interface Element {
  tag: string;
  attribs: Record<string, string>;
  children: Node[];
}

type Node = Element | { text: string };

const isElement = (node: Node): node is Element => 'tag' in node;

const LOCATION_TYPES: readonly RottnestLocationType[] = [
  'self-contained',
  'hostel-dorms',
  'campground',
];

/**
 * `html` as an element tree, read by sanitize-html's parser with every tag and attribute
 * allowed: its hooks report each element as it opens and closes (implied closes included) and
 * each text, escaped. Script and style text never reaches the text hook.
 */
function parse(html: string): Element {
  const root: Element = { tag: '#root', attribs: {}, children: [] };
  const stack: Element[] = [root];
  const top = (): Element => stack[stack.length - 1];
  sanitizeHtml(html, {
    allowedTags: false,
    allowedAttributes: false,
    // Only the hooks are used, never the output, so allowing script and style is safe here.
    allowVulnerableTags: true,
    onOpenTag: (tag, attribs) => {
      const element: Element = { tag, attribs, children: [] };
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

function findAll(from: Element, test: (element: Element) => boolean, found: Element[] = []) {
  for (const child of from.children) {
    if (!isElement(child)) continue;
    if (test(child)) found.push(child);
    else findAll(child, test, found);
  }
  return found;
}

const classes = (element: Element): string[] => (element.attribs.class ?? '').split(/\s+/);
const hasClass = (name: string) => (element: Element) => classes(element).includes(name);

const unescape = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');

function textOf(node: Node): string {
  const raw = (n: Node): string => (isElement(n) ? n.children.map(raw).join('') : unescape(n.text));
  return raw(node).replace(/\s+/g, ' ').trim();
}

/** A whole number from an attribute, or undefined. */
function wholeNumber(value: string | undefined): number | undefined {
  if (value === undefined || !/^\s*\d+\s*$/.test(value)) return undefined;
  return Number(value);
}

/** "$1,074.00" as 1074, or undefined. */
export function readPrice(text: string): number | undefined {
  const match = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(text);
  if (!match) return undefined;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
}

function readCard(card: Element): ResultsCard | undefined {
  const code = card.attribs['room-calendar-root']?.trim();
  if (!code || !/^[A-Z0-9]{2,12}$/.test(code)) return undefined;
  const heading = findAll(card, (el) => el.tag === 'h2' && hasClass('icon-header-info')(el))[0];
  const priceEl = findAll(card, hasClass('currency-symbol'))[0];
  const type = card.attribs['data-location-type'];
  const rates = new Set<string>();
  const targetPattern = new RegExp(`^#([A-Z0-9_]+)-${code}$`);
  for (const button of findAll(card, (el) => el.tag === 'button' && hasClass('rate-name')(el))) {
    const match = targetPattern.exec(button.attribs['data-target'] ?? '');
    if (match) rates.add(match[1]);
  }
  const unavailable = classes(card).includes('unavailable');
  const result: ResultsCard = {
    code,
    group: wholeNumber(card.attribs['data-group']) ?? Number.NaN,
    name: heading ? textOf(heading) : code,
    unavailable,
    rates: [...rates],
  };
  if (LOCATION_TYPES.includes(type as RottnestLocationType)) {
    result.locationType = type as RottnestLocationType;
  }
  const sleeps = wholeNumber(card.attribs['data-sleeps']);
  const bedrooms = wholeNumber(card.attribs['data-bedrooms']);
  if (sleeps !== undefined) result.sleeps = sleeps;
  if (bedrooms !== undefined) result.bedrooms = bedrooms;
  if (!unavailable && priceEl) {
    const price = readPrice(textOf(priceEl));
    if (price !== undefined) result.price = price;
  }
  return result;
}

/**
 * The room types on a results page, by code (the first card of a code wins), or undefined when
 * the page has no card it can read.
 */
export function readResultsPage(html: string): Map<string, ResultsCard> | undefined {
  const root = parse(html);
  const cards = findAll(
    root,
    (el) => el.tag === 'div' && hasClass('room-and-rates')(el) && 'room-calendar-root' in el.attribs
  );
  const byCode = new Map<string, ResultsCard>();
  for (const element of cards) {
    const card = readCard(element);
    if (card && !byCode.has(card.code)) byCode.set(card.code, card);
  }
  return byCode.size > 0 ? byCode : undefined;
}
