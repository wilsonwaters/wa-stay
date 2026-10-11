/**
 * A campground's description: what ParkStay marks `<span class="disable">` (struck through by
 * its own `<style>`) must read as not available once sanitised, on Bungarra's real
 * `long_description`.
 */

import {
  campgroundDescriptionHtml,
  markUnavailableItems,
  UNAVAILABLE_MARKER,
} from '@main/providers/parkstay/description';
import type { RawCampsiteAvailabilityView } from '@main/providers/parkstay/types';
import { parkStayFixture } from '@tests/utils/parkstay-fixture-server';

const LONG_DESCRIPTION = parkStayFixture<RawCampsiteAvailabilityView>(
  'campsite_availablity_view_20.json'
).long_description;

/** HTML as the words it reads as: tags out, entities ParkStay uses decoded, spaces collapsed. */
const textOf = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** The items ParkStay marks `disable`, read from the raw HTML. */
const disabledItems = (html: string): string[] =>
  [...html.matchAll(/<span class="disable">([\s\S]*?)<\/span>/g)].map((m) => textOf(m[1]));

describe('ParkStay campground description', () => {
  const html = campgroundDescriptionHtml(LONG_DESCRIPTION);
  const text = textOf(html);

  it('reads the items Bungarra lacks as not available', () => {
    const items = disabledItems(LONG_DESCRIPTION);
    expect(items).toEqual([
      'Campfires permitted',
      'Pets permitted',
      'Generators permitted',
      'Drinking water',
      'Showers',
      'Dump station',
      'Picnic tables',
      'Gas barbecues',
      'Dishwashing',
      'Powered sites',
    ]);
    for (const item of items) expect(text).toContain(`${item}${UNAVAILABLE_MARKER}`);
  });

  it('never shows a disable-marked item without its marker', () => {
    for (const item of disabledItems(LONG_DESCRIPTION)) {
      const occurrences = text.split(item).slice(1);
      expect(occurrences.length).toBeGreaterThan(0);
      for (const after of occurrences) expect(after.startsWith(UNAVAILABLE_MARKER)).toBe(true);
    }
    expect(text.split('(not available)')).toHaveLength(11);
  });

  it('leaves what the campground has as it is', () => {
    for (const item of [
      'Freestanding tents & swags',
      'No-flush pit toilets',
      '2WD access',
      'Unsealed roads within the campground',
    ]) {
      expect(text).toContain(item);
      expect(text).not.toContain(`${item}${UNAVAILABLE_MARKER}`);
    }
  });

  it('drops the inline style and every class, as the sanitiser does', () => {
    expect(html).not.toMatch(/<style|style=|class=/);
    expect(text).not.toContain('span.disable');
    expect(text).not.toContain('line-through');
  });
});

describe('markUnavailableItems', () => {
  it('puts the marker inside the span, at its end', () => {
    expect(markUnavailableItems('<span class="disable"><i></i>Showers</span>')).toBe(
      '<span class="disable"><i></i>Showers (not available)</span>'
    );
  });

  it('finds disable among other classes and in any quoting, but not disabled', () => {
    expect(markUnavailableItems(`<span class='x disable'>A</span>`)).toContain('A (not available)');
    expect(markUnavailableItems('<span id="a" class=disable>A</span>')).toContain(
      'A (not available)'
    );
    expect(markUnavailableItems('<span class="disabled">A</span>')).toBe(
      '<span class="disabled">A</span>'
    );
    expect(markUnavailableItems('<span class="not-disable">A</span>')).toBe(
      '<span class="not-disable">A</span>'
    );
  });

  it('follows nested spans to the disabled one’s own end', () => {
    expect(
      markUnavailableItems(
        '<span class="disable"><span>Gas</span> barbecues</span> <span>Toilet</span>'
      )
    ).toBe(
      '<span class="disable"><span>Gas</span> barbecues (not available)</span> <span>Toilet</span>'
    );
  });

  it('marks a disabled span left open at the end, and skips one with no text', () => {
    expect(markUnavailableItems('<div><span class="disable">Showers</div>')).toBe(
      '<div><span class="disable">Showers</div> (not available)'
    );
    expect(markUnavailableItems('<span class="disable"><i class=""> </i></span>')).toBe(
      '<span class="disable"><i class=""> </i></span>'
    );
  });

  it('leaves HTML without disabled items untouched', () => {
    const plain = '<p>Book with the park office.</p><span>Toilet</span>';
    expect(markUnavailableItems(plain)).toBe(plain);
  });
});
