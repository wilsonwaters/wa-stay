/**
 * A campground's description from the availability view's `long_description`, made safe to
 * show.
 *
 * ParkStay marks what a campground does not have with `<span class="disable">`, struck
 * through by an inline `<style>` (`span.disable { text-decoration: line-through; }`). The
 * sanitiser drops both the class and the style, which would leave "Campfires permitted" or
 * "Drinking water" reading as if the campground had them. So, before sanitising, each such
 * item gets its meaning in words, "Campfires permitted (not available)", which reads the same
 * to sighted and screen-reader users. The `<style>` goes with the sanitiser.
 */

import { sanitizeProviderHtml } from '../sdk/html';
import { PARKSTAY_BASE_URL } from './constants';

/** What follows an item the campground does not have. */
export const UNAVAILABLE_MARKER = ' (not available)';

/** An opening or closing `span` tag. */
const SPAN_TAG = /<(\/?)span\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
/** A `class` attribute that lists `disable` (not `disabled`, not `not-disable`). */
const DISABLE_CLASS =
  /\sclass\s*=\s*(?:"(?:[^"]*\s)?disable(?:\s[^"]*)?"|'(?:[^']*\s)?disable(?:\s[^']*)?'|disable(?=[\s/>]))/i;

/** Whether an HTML fragment has any text once its tags are left out. */
const hasText = (html: string): boolean => /\S/.test(html.replace(/<[^>]*>/g, ''));

/**
 * `html` with `UNAVAILABLE_MARKER` at the end of every `<span class="disable">` that holds
 * text, inside the span. Spans nest; a disabled span left open runs to the end, so its marker
 * goes there.
 */
export function markUnavailableItems(html: string): string {
  const open: Array<{ disabled: boolean; contentStart: number }> = [];
  let result = '';
  let last = 0;
  for (const match of html.matchAll(SPAN_TAG)) {
    const index = match.index;
    result += html.slice(last, index);
    last = index + match[0].length;
    if (match[1] !== '/') {
      open.push({ disabled: DISABLE_CLASS.test(match[0]), contentStart: last });
    } else {
      const span = open.pop();
      if (span?.disabled && hasText(html.slice(span.contentStart, index))) {
        result += UNAVAILABLE_MARKER;
      }
    }
    result += match[0];
  }
  result += html.slice(last);
  for (const span of open.reverse()) {
    if (span.disabled && hasText(html.slice(span.contentStart))) result += UNAVAILABLE_MARKER;
  }
  return result;
}

/** `long_description` as safe HTML, with the items the campground lacks said so in words. */
export function campgroundDescriptionHtml(longDescription: string): string {
  return sanitizeProviderHtml(markUnavailableItems(longDescription), PARKSTAY_BASE_URL);
}
