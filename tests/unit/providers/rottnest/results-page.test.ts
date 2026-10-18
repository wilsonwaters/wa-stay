/**
 * Reading Stay Rottnest's results page (`src/main/providers/rottnest/results-page.ts`), on the
 * stakeholder's capture (trimmed, `tests/fixtures/providers/rottnest/`): every room type's
 * attributes, name, price and rates, free or unavailable; and pages it must not read as
 * "nothing free".
 */

import fs from 'fs';
import path from 'path';
import { readPrice, readResultsPage } from '@main/providers/rottnest/results-page';

const FIXTURES = path.join(__dirname, '../../../fixtures/providers/rottnest');
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

describe('readResultsPage', () => {
  const cards = readResultsPage(read('results-2027-06-28-3n-1a.html'))!;

  it('reads all 68 room types, 34 free and 34 unavailable, and ignores a card inside a script', () => {
    expect(cards.size).toBe(68);
    const all = [...cards.values()];
    expect(all.filter((card) => !card.unavailable && card.price !== undefined)).toHaveLength(34);
    expect(all.filter((card) => card.unavailable)).toHaveLength(34);
    expect(cards.has('FAKE01')).toBe(false);
  });

  it('reads a free room type: its facts, its whole-stay price and its rate', () => {
    expect(cards.get('GPV04')).toEqual({
      code: 'GPV04',
      group: 39,
      locationType: 'self-contained',
      sleeps: 6,
      bedrooms: 2,
      name: 'Geordie Bay Premium View - 4 Beds',
      unavailable: false,
      price: 1074,
      rates: ['RIA25'],
    });
    expect(cards.get('CG06')).toMatchObject({
      locationType: 'campground',
      price: 135,
      rates: ['CAMPING'],
    });
    expect(cards.get('KYB01')).toMatchObject({
      locationType: 'hostel-dorms',
      sleeps: 1,
      rates: ['HOSTS'],
    });
  });

  it("reads RIA's names with their apostrophes", () => {
    expect(cards.get('FPR04')?.name).toBe("Fay's Bay Premium - 4 Beds");
  });

  it('reads an unavailable room type with no price and no rate', () => {
    expect(cards.get('BPV04')).toEqual({
      code: 'BPV04',
      group: 43,
      locationType: 'self-contained',
      sleeps: 6,
      bedrooms: 2,
      name: 'Bathurst Premium View - 4 Bed',
      unavailable: true,
      rates: [],
    });
  });

  it('reads the sold-out page as every type unavailable', () => {
    const soldOut = readResultsPage(read('results-all-unavailable.html'))!;
    expect(soldOut.size).toBe(68);
    expect(
      [...soldOut.values()].every((card) => card.unavailable && card.price === undefined)
    ).toBe(true);
  });

  it('reads a page with no room type (a challenge, an error, a redesign) as undefined', () => {
    expect(
      readResultsPage('<html><head><title>Just a moment...</title></head></html>')
    ).toBeUndefined();
    expect(readResultsPage('<div class="room-and-rates"></div>')).toBeUndefined();
    expect(
      readResultsPage('<div class="room-and-rates" room-calendar-root="not a code"></div>')
    ).toBeUndefined();
  });

  it('does not read a card with no price as free', () => {
    const page =
      '<div class="card-style room-and-rates" room-calendar-root="GPV04" data-group="39"><h2 class="icon-header-info">X</h2></div>';
    const card = readResultsPage(page)?.get('GPV04');
    expect(card?.unavailable).toBe(false);
    expect(card?.price).toBeUndefined();
  });
});

describe('readPrice', () => {
  it.each([
    [' $1,074.00', 1074],
    ['$135.00', 135],
    ['$2,694.5', 2694.5],
    ['from', undefined],
  ])('%s → %s', (text, value) => {
    expect(readPrice(text)).toBe(value);
  });
});
