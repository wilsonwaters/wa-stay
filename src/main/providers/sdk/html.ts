/**
 * `sanitizeProviderHtml`: makes a provider's HTML (a campground description, say) safe to
 * cross IPC and render in the renderer. Main sanitises every provider's detail HTML with it
 * before it leaves the main process (architecture-notes §3 `LocationDetail.descriptionHtml`).
 *
 * - Only simple text structure is kept: `p, br, hr, h3–h6, strong, em, ul, ol, li, div,
 *   span`, links (`a[href]`) and images (`img[src|alt]`). Any other tag is dropped and its
 *   text kept; `<style>`, `<script>` and `<iframe>` are dropped with their content.
 * - No other attribute survives, so `style`, `class` and `on*` handlers are gone.
 * - Relative `href` and `src` are made absolute against `baseUrl`. Only https URLs are
 *   kept: a link to anything else loses its `href`, and an image without an https `src` is
 *   dropped. An image without alt text gets `alt=""` (decoration).
 * - Every link gets `rel="noopener noreferrer"`, and a link with an `href` gets
 *   `target="_blank"`: the app window turns a new window into the system browser
 *   (`setWindowOpenHandler`), while a plain navigation away from the app is blocked, so this
 *   is what makes a description's links open at all.
 * - Headings nest under the page's own sections (`h2`): the provider's highest heading
 *   becomes `h3` and the others keep their depth below it, down to `h6`. `topHeading` moves
 *   the highest one lower: `4` under a section's own `h3` title (`LocationDetail.sections`).
 * - `dropImages` leaves out images the page already shows (the place's photos).
 */

import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'div',
  'span',
];

/** `value` resolved against `baseUrl`, or undefined when it is missing or not a URL. */
function absolute(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value.trim(), baseUrl).href;
  } catch {
    return undefined;
  }
}

function withUrl(
  attribs: sanitizeHtml.Attributes,
  name: 'href' | 'src',
  baseUrl: string
): sanitizeHtml.Attributes {
  const result = { ...attribs };
  const url = absolute(attribs[name], baseUrl);
  if (url) result[name] = url;
  else delete result[name];
  return result;
}

/** The level the provider's highest heading takes by default: under the page's `h2` sections. */
const TOP_HEADING = 3;
const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

/** The highest heading level `html` uses (1 for `h1`), or undefined when it has none. */
function topHeadingLevel(html: string): number | undefined {
  const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]));
  return levels.length ? Math.min(...levels) : undefined;
}

/** `url` in one canonical form, or undefined when it is not a URL. */
function canonicalUrl(url: string, baseUrl: string): string | undefined {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return undefined;
  }
}

export interface SanitizeOptions {
  /** Image URLs to leave out, such as the photos the page already shows in its gallery. */
  dropImages?: readonly string[];
  /** The level the provider's highest heading takes, 3 (the default) to 6. */
  topHeading?: number;
}

export function sanitizeProviderHtml(
  html: string,
  baseUrl: string,
  options: SanitizeOptions = {}
): string {
  const wanted = Math.trunc(options.topHeading ?? TOP_HEADING);
  const highest = Number.isFinite(wanted)
    ? Math.min(6, Math.max(TOP_HEADING, wanted))
    : TOP_HEADING;
  const top = topHeadingLevel(html) ?? highest;
  const nestHeading = (tagName: string) => ({
    tagName: `h${Math.min(6, Math.max(highest, Number(tagName[1]) - top + highest))}`,
    attribs: {},
  });
  const dropped = new Set(
    (options.dropImages ?? [])
      .map((url) => canonicalUrl(url, baseUrl))
      .filter((url): url is string => Boolean(url))
  );
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href', 'target', 'rel'], img: ['src', 'alt'] },
    // Dropped together with their content.
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'iframe'],
    allowedSchemes: ['https'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    transformTags: {
      ...Object.fromEntries(HEADINGS.map((tag) => [tag, nestHeading])),
      // Presentational emphasis keeps its meaning as the semantic tags (ParkStay's sections bold
      // their key sentences with `b`).
      b: 'strong',
      i: 'em',
      a: (tagName, attribs) => {
        const link = withUrl(attribs, 'href', baseUrl);
        // The provider's own target (`_top`, a frame name) never survives.
        delete link.target;
        // Only an https href survives the scheme filter below.
        if (link.href?.startsWith('https://')) link.target = '_blank';
        return { tagName, attribs: { ...link, rel: 'noopener noreferrer' } };
      },
      // A description's image without alt text is decoration (its text says what matters):
      // `alt=""`, never an unnamed image.
      img: (tagName, attribs) => ({
        tagName,
        attribs: { ...withUrl(attribs, 'src', baseUrl), alt: attribs.alt ?? '' },
      }),
    },
    // An image whose source is not https would render as a broken box; one the page already
    // shows would be a duplicate.
    exclusiveFilter: (frame) => {
      if (frame.tag !== 'img') return false;
      const src = frame.attribs.src ?? '';
      return !src.startsWith('https://') || dropped.has(canonicalUrl(src, baseUrl) ?? src);
    },
  });
}
