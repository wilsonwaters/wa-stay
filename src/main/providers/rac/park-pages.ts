/**
 * The two RAC pages that show what a park looks like and what RAC says about it: RAC's parks
 * page, for Explore's cards, and a park's home page, for its place page. Both are WordPress
 * pages rendered on the server, read live (anonymously, checked on 18 Oct 2026) and shown only
 * in the app: RAC's photos and words, as RAC publishes them, with the link to RAC's page (terms
 * rule 6). Nothing of them is kept in the repository: the fixtures are synthetic (rule 7).
 *
 * - **RAC's parks page**, `GET /bookings/` ("Book now", `RAC_PARKS_PAGE_PATH`), lists every park
 *   in one grid: each `div.park-grid-block__parks__item` has the park's photo
 *   (`img.park-grid-block__parks__item__img`: the photo in `data-src`, a placeholder in `src`,
 *   and the photo again in a `noscript` `img`) and its "Check availability" link to
 *   `/<slug>/book-now/`, which says which park it is. One request gives every card its photo.
 * - **A park's home page**, `GET /<slug>/`, the same at every park, on RAC's widget or on
 *   NewBook's own engine:
 *   - its hero banner (`div.large-park-hero-banner__slider__item`, one per slide, the photo in
 *     `data-back`), else its `og:image`: the park's own photos;
 *   - its intro: the paragraphs (`p`) beside the page's one `h1` ("Welcome to RAC Busselton
 *     Holiday Park"), RAC's own words with their links, as sanitised HTML (`descriptionHtml`);
 *   - its accommodation grid (`.accommodation-and-sites-block__grid__item__gallery`): photos of
 *     its categories, on NewBook's image host, which a NewBook-native park's place page shows
 *     (its book-now page has none).
 *
 * A park's own photos are kept only when they are https on RAC's host, under WordPress's
 * uploads (`racPhotoUrl`); its accommodation photos only on NewBook's image host
 * (`racImageUrl`). A page in another shape (a redesign) reads as having none of these: the
 * caller then shows the park without them.
 */

import { sanitizeProviderHtml } from '../sdk/html';
import {
  findAll,
  hasClass,
  parseHtml,
  racImageUrl,
  textOf,
  type HtmlElement,
  type HtmlNode,
} from './book-now';
import { RAC_SITE_URL } from './client';

/** RAC's "Book now" page, whose grid shows every park with a photo. */
export const RAC_PARKS_PAGE_PATH = '/bookings/';

/** The most intro paragraphs a park's description takes: a redesign never brings a whole page. */
export const RAC_INTRO_MAX_PARAGRAPHS = 8;

const RAC_HOST = new URL(RAC_SITE_URL).host;

/** A photo WordPress serves: under its uploads, optionally below a park's own path. */
const UPLOADED_PHOTO = /^\/(?:[a-z0-9-]+\/)?wp-content\/uploads\/[^?#]*\.(?:jpe?g|png|webp)$/i;

/** A park's link to its book-now page: `/<slug>/book-now/`, relative or on RAC's host. */
const BOOK_NOW_LINK = /^\/([a-z0-9-]+)\/book-now\/?$/;

/** What a park's home page shows of it. */
export interface ParkHomePage {
  /** The park's own photos, https on RAC's host: its hero banner's slides, else its og:image. */
  photos: string[];
  /** The intro, RAC's own paragraphs and their links, sanitised; absent when there is none. */
  descriptionHtml?: string;
  /** Its accommodation grid's photos, https on NewBook's image host, in the page's order. */
  accommodationPhotos: string[];
}

/**
 * An https photo on RAC's own host under WordPress's uploads
 * (`/wp-content/uploads/…` or `/<slug>/wp-content/uploads/…`), or undefined.
 */
export function racPhotoUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  const onRac =
    url.protocol === 'https:' &&
    url.host === RAC_HOST &&
    !url.username &&
    !url.password &&
    UPLOADED_PHOTO.test(url.pathname);
  return onRac ? url.href : undefined;
}

const isElement = (node: HtmlNode): node is HtmlElement => 'tag' in node;

/** Adds each of `urls` that is defined to `into`, once. */
function addAll(into: string[], urls: Array<string | undefined>): void {
  for (const url of urls) if (url && !into.includes(url)) into.push(url);
}

/** The photos of an `img` (lazy-loaded: `data-src`, else `src`), as `check` allows. */
function imgSources(
  img: HtmlElement,
  check: (value: string | undefined) => string | undefined
): Array<string | undefined> {
  return [check(img.attribs['data-src']), check(img.attribs.src)];
}

/** The park's slug a link to its book-now page names, or undefined. */
function bookNowSlug(href: string | undefined): string | undefined {
  if (!href) return undefined;
  let url: URL;
  try {
    url = new URL(href.trim(), RAC_SITE_URL);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.host !== RAC_HOST) return undefined;
  return BOOK_NOW_LINK.exec(url.pathname)?.[1];
}

/**
 * RAC's parks page: each park's photo, by its slug (from the park's book-now link), in the
 * page's order. A park with no photo on RAC's host is left out; of two items for one park, the
 * first counts. Empty when the page has no parks grid.
 */
export function readParksPage(html: string): Map<string, string> {
  const photos = new Map<string, string>();
  for (const item of findAll(parseHtml(html), hasClass('park-grid-block__parks__item'))) {
    const slug = findAll(item, (element) => element.tag === 'a')
      .map((link) => bookNowSlug(link.attribs.href))
      .find((found) => found !== undefined);
    if (!slug || photos.has(slug)) continue;
    const found: string[] = [];
    for (const img of findAll(item, (element) => element.tag === 'img')) {
      addAll(found, imgSources(img, racPhotoUrl));
    }
    if (found.length > 0) photos.set(slug, found[0]);
  }
  return photos;
}

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline tags an intro paragraph keeps; any other keeps its text only. */
const INLINE = new Set(['strong', 'em', 'b', 'i']);

/** A paragraph's content as HTML: its text (already escaped), links, emphasis and breaks. */
function inlineHtml(node: HtmlNode): string {
  if (!isElement(node)) return node.text;
  if (node.tag === 'br') return '<br>';
  const inner = node.children.map(inlineHtml).join('');
  if (node.tag === 'a') {
    const href = node.attribs.href?.trim();
    return href ? `<a href="${escapeAttribute(href)}">${inner}</a>` : inner;
  }
  return INLINE.has(node.tag) ? `<${node.tag}>${inner}</${node.tag}>` : inner;
}

/**
 * The intro: the paragraphs beside the page's first `h1`, after it, that have text, as `<p>`s
 * (at most `RAC_INTRO_MAX_PARAGRAPHS`), sanitised against `pageUrl`. Undefined when there are
 * none.
 */
function introHtml(root: HtmlElement, pageUrl: string): string | undefined {
  const [heading] = findAll(root, (element) => element.tag === 'h1');
  if (!heading) return undefined;
  const [parent] = findAll(root, (element) => element.children.includes(heading));
  const holder = parent ?? root;
  const after = holder.children.slice(holder.children.indexOf(heading) + 1);
  const paragraphs = after
    .filter((node): node is HtmlElement => isElement(node) && node.tag === 'p')
    .filter((paragraph) => textOf(paragraph) !== '')
    .slice(0, RAC_INTRO_MAX_PARAGRAPHS)
    .map((paragraph) => `<p>${paragraph.children.map(inlineHtml).join('').trim()}</p>`);
  if (paragraphs.length === 0) return undefined;
  const html = sanitizeProviderHtml(paragraphs.join(''), pageUrl).trim();
  return html === '' ? undefined : html;
}

/**
 * A park's home page: its own photos, its intro and its accommodation grid's photos. `pageUrl`
 * is the page's address, which the intro's relative links are read against.
 */
export function readParkHomePage(html: string, pageUrl: string): ParkHomePage {
  const root = parseHtml(html);
  const photos: string[] = [];
  for (const slide of findAll(root, hasClass('large-park-hero-banner__slider__item'))) {
    addAll(photos, [racPhotoUrl(slide.attribs['data-back'])]);
  }
  if (photos.length === 0) {
    const og = findAll(
      root,
      (element) => element.tag === 'meta' && element.attribs.property === 'og:image'
    );
    addAll(
      photos,
      og.map((meta) => racPhotoUrl(meta.attribs.content))
    );
  }
  const accommodationPhotos: string[] = [];
  for (const gallery of findAll(
    root,
    hasClass('accommodation-and-sites-block__grid__item__gallery')
  )) {
    for (const img of findAll(gallery, (element) => element.tag === 'img')) {
      addAll(accommodationPhotos, imgSources(img, racImageUrl));
    }
  }
  const page: ParkHomePage = { photos, accommodationPhotos };
  const description = introHtml(root, pageUrl);
  if (description) page.descriptionHtml = description;
  return page;
}
