/**
 * A park's book-now page, `GET /<slug>/book-now/`, for the five parks on RAC's own widget: its
 * categories, which the place page shows as units. The page is rendered on the server
 * (WordPress), so its HTML is the only source; no request beyond it is needed.
 *
 * - **Categories.** One `div.accommodation-item` each, its facts in attributes: `data-cat-id`
 *   (NewBook's category id), `data-cat-type-id`, `data-max-guests`, `data-max-animals` (0: no
 *   pets), `data-accessible`, `data-allowed-equipment` (ids, or `false` for a cabin) and
 *   `data-active`. Inside: the title (`h2.accommodation-item__title`), the photo gallery
 *   (`img` with the photo in `data-src`, a placeholder in `src`, and the photo again in a
 *   `noscript` `img`), the feature list (`li.accommodation-item__features__item`) and a short
 *   description (`.accommodation-item__description`).
 * - **Names.** The type filter (`input.accommodation-filters__type__checkbox`: `value` the
 *   type id, `data-name` its label) and the equipment select (`select#equipment_type`).
 * - **Notices.** One `div.booking-notification` per dated notice (`data-date-from` and
 *   `data-date-to`, `YYYYMMDD`), with a title and a description.
 *
 * Inactive categories (`data-active="false"`) are left out, and of two with one category id,
 * the first is kept. Photos are kept only from NewBook's image host, over https. A page with
 * no category at all (a redesign) reads as `undefined`.
 *
 * The page is parsed with sanitize-html's parser (htmlparser2), through its open, close and
 * text hooks: no other HTML library. The small element tree (`parseHtml`, `findAll`,
 * `hasClass`, `textOf`) is shared with the cart page's reader (`cart-page.ts`).
 */

import sanitizeHtml from 'sanitize-html';

/** NewBook's image host, where RAC's category photos are. */
export const RAC_IMAGE_HOST = 'driveau.newbook.cloud';

export interface BookNowCategory {
  /** NewBook's category id (`data-cat-id`). */
  catId: string;
  /** NewBook's category type id (`data-cat-type-id`). */
  typeId?: string;
  title: string;
  /** Absent when the page gives no number. */
  maxGuests?: number;
  /** The most pets allowed; 0 when none are. */
  maxPets: number;
  accessible: boolean;
  /** Equipment type ids the category takes; empty for a cabin. */
  equipmentIds: string[];
  /** The feature list's words, in the page's order. */
  features: string[];
  /** The short description, as plain text. */
  description?: string;
  /** https photos on `RAC_IMAGE_HOST`, in the gallery's order. */
  imageUrls: string[];
}

export interface BookNowNotice {
  /** Calendar dates `YYYY-MM-DD`. */
  from: string;
  to: string;
  /** Plain text; may be empty. */
  title: string;
  /** Plain text. */
  text: string;
}

export interface BookNowPage {
  /** Category type id → its label ("Cabins", "Sites"). */
  types: ReadonlyMap<string, string>;
  /** Equipment type id → its name ("Caravan with Awning"). */
  equipment: ReadonlyMap<string, string>;
  categories: BookNowCategory[];
  notices: BookNowNotice[];
}

// ---------------------------------------------------------------------------------------
// A small element tree
// ---------------------------------------------------------------------------------------

export interface HtmlElement {
  tag: string;
  attribs: Record<string, string>;
  children: HtmlNode[];
}

/** A text node holds its text escaped as HTML (`&amp;`, `&lt;`, `&gt;`). */
export type HtmlNode = HtmlElement | { text: string };

const isElement = (node: HtmlNode): node is HtmlElement => 'tag' in node;

/**
 * `html` as an element tree, read by sanitize-html's parser with every tag and attribute
 * allowed: its hooks report each element as it opens and closes (implied closes included) and
 * each text, escaped. Script and style text never reaches the text hook.
 */
export function parseHtml(html: string): HtmlElement {
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

export function findAll(
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

export const hasClass = (name: string) => (element: HtmlElement) =>
  (element.attribs.class ?? '').split(/\s+/).includes(name);

const unescapeText = (text: string): string =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The element's text, unescaped, with runs of white space as one space. */
export function textOf(node: HtmlNode): string {
  const raw = (n: HtmlNode): string =>
    isElement(n) ? n.children.map(raw).join('') : unescapeText(n.text);
  return raw(node).replace(/\s+/g, ' ').trim();
}

const BLOCKS = new Set(['p', 'div', 'li', 'ul', 'ol', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/**
 * The element's text as one plain paragraph: its blocks (paragraphs, list items) joined by
 * spaces, a list item ending with a full stop when it has no punctuation of its own.
 */
function plainText(node: HtmlElement): string {
  const parts: string[] = [];
  let current = '';
  const flush = (item: boolean): void => {
    const text = current.replace(/\s+/g, ' ').trim();
    current = '';
    if (text) parts.push(item && !/[.!?:;]$/.test(text) ? `${text}.` : text);
  };
  const walk = (element: HtmlElement): void => {
    for (const child of element.children) {
      if (!isElement(child)) {
        current += unescapeText(child.text);
      } else if (BLOCKS.has(child.tag)) {
        flush(false);
        walk(child);
        flush(child.tag === 'li');
      } else {
        walk(child);
      }
    }
  };
  walk(node);
  flush(false);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------------------
// Reading the page
// ---------------------------------------------------------------------------------------

/** An https photo on NewBook's image host, or undefined. */
export function racImageUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname === RAC_IMAGE_HOST ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** A count from an attribute: a whole number of 0 or more, else undefined. */
function countOf(value: string | undefined): number | undefined {
  if (value === undefined || !/^\s*\d+\s*$/.test(value)) return undefined;
  return Number(value);
}

/** `20270924` → `2027-09-24`, or undefined. */
function dateOf(value: string | undefined): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value?.trim() ?? '');
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

/** The excerpt's "[...]" as an ellipsis. */
const withoutMoreMarker = (text: string): string => text.replace(/\s*\[(?:\.\.\.|…)\]\s*$/, '…');

function readCategory(item: HtmlElement): BookNowCategory | undefined {
  const { attribs } = item;
  const catId = attribs['data-cat-id']?.trim();
  if (!catId) return undefined;
  const [heading] = findAll(item, hasClass('accommodation-item__title'));
  const title = (heading ? textOf(heading) : '') || attribs['data-title']?.trim() || '';
  if (!title) return undefined;

  const imageUrls: string[] = [];
  for (const gallery of findAll(item, hasClass('accommodation-item__gallery'))) {
    for (const img of findAll(gallery, (element) => element.tag === 'img')) {
      for (const candidate of [img.attribs['data-src'], img.attribs.src]) {
        const url = racImageUrl(candidate);
        if (url && !imageUrls.includes(url)) imageUrls.push(url);
      }
    }
  }
  const [description] = findAll(item, hasClass('accommodation-item__description'));
  const descriptionText = description ? withoutMoreMarker(textOf(description)) : '';
  const equipment = attribs['data-allowed-equipment']?.trim() ?? '';

  const category: BookNowCategory = {
    catId,
    title,
    maxPets: countOf(attribs['data-max-animals']) ?? 0,
    accessible: attribs['data-accessible']?.trim() === 'true',
    equipmentIds:
      equipment === '' || equipment === 'false'
        ? []
        : equipment
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),
    features: findAll(item, hasClass('accommodation-item__features__item'))
      .map(textOf)
      .filter(Boolean),
    imageUrls,
  };
  const typeId = attribs['data-cat-type-id']?.trim();
  if (typeId) category.typeId = typeId;
  const maxGuests = countOf(attribs['data-max-guests']);
  if (maxGuests !== undefined && maxGuests > 0) category.maxGuests = maxGuests;
  if (descriptionText) category.description = descriptionText;
  return category;
}

function readNotice(element: HtmlElement): BookNowNotice | undefined {
  const from = dateOf(element.attribs['data-date-from']);
  const to = dateOf(element.attribs['data-date-to']);
  if (!from || !to) return undefined;
  const [title] = findAll(element, hasClass('booking-notification__title'));
  const [description] = findAll(element, hasClass('booking-notification__description'));
  const text = description ? plainText(description) : '';
  if (!text) return undefined;
  return { from, to, title: title ? textOf(title) : '', text };
}

/**
 * The page's categories, names and notices, or `undefined` when it lists no category at all
 * (not a widget page, or a redesign).
 */
export function readBookNowPage(html: string): BookNowPage | undefined {
  const root = parseHtml(html);
  const items = findAll(root, hasClass('accommodation-item'));
  if (items.length === 0) return undefined;

  const types = new Map<string, string>();
  for (const input of findAll(root, hasClass('accommodation-filters__type__checkbox'))) {
    const id = input.attribs.value?.trim();
    const label = input.attribs['data-name']?.trim();
    if (id && label && !types.has(id)) types.set(id, label);
  }

  const equipment = new Map<string, string>();
  const [select] = findAll(root, (element) => element.attribs.id === 'equipment_type');
  for (const option of select ? findAll(select, (element) => element.tag === 'option') : []) {
    const id = option.attribs.value?.trim();
    const name = textOf(option);
    if (id && id !== 'all' && name && !equipment.has(id)) equipment.set(id, name);
  }

  const categories: BookNowCategory[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.attribs['data-active']?.trim() === 'false') continue;
    const category = readCategory(item);
    if (!category || seen.has(category.catId)) continue;
    seen.add(category.catId);
    categories.push(category);
  }

  const notices = findAll(root, hasClass('booking-notification'))
    .map(readNotice)
    .filter((notice): notice is BookNowNotice => notice !== undefined);

  return { types, equipment, categories, notices };
}
