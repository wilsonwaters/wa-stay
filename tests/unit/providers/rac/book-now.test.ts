/**
 * RAC's book-now page (`src/main/providers/rac/book-now.ts`): the categories, type labels,
 * equipment names and dated notices, on the trimmed Busselton fixture and on small pages that
 * show the edge cases (inactive and duplicate categories, a guest count that is not a number,
 * photos on another host or over http, a page with no category at all).
 */

import fs from 'fs';
import path from 'path';
import { RAC_IMAGE_HOST, racImageUrl, readBookNowPage } from '@main/providers/rac/book-now';

const FIXTURES = path.join(__dirname, '../../../fixtures/providers/rac');
const busselton = fs.readFileSync(path.join(FIXTURES, 'book-now-busselton.html'), 'utf8');
const placeholder = (n: number) =>
  `https://driveau.newbook.cloud/crop_800_450/instances_00000000000000000000000000000000_${n}.jpg`;

/** A category as the widget writes it. */
function item(attributes: Record<string, string>, inner = ''): string {
  const attrs = Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('');
  return `<div class="accommodation-item"${attrs}>${inner}</div>`;
}

describe('readBookNowPage', () => {
  it("reads Busselton's categories in the page's order, with their facts", () => {
    const page = readBookNowPage(busselton)!;
    expect(page.categories.map((c) => [c.catId, c.typeId, c.title])).toEqual([
      ['9', '5', 'Two Bedroom Cabin (Sleeps 4)'],
      ['3', '5', 'Studio Room'],
      ['7', '2', 'Ensuite Site'],
      ['20', '2', 'Powered Big Rig Site'],
      ['4', '2', 'Powered Site'],
      ['5', '2', 'Unpowered Site'],
    ]);
    expect(page.categories[4]).toEqual({
      catId: '4',
      typeId: '2',
      title: 'Powered Site',
      maxGuests: 6,
      maxPets: 2,
      accessible: false,
      equipmentIds: ['2', '1', '15', '12', '6', '5', '4', '10', '3', '14', '11', '13', '7', '9'],
      features: ['Max. 6 guests', 'Power', 'Water', 'Pet-friendly'],
      description: 'Placeholder description.',
      // The lazy-loaded photo and its noscript copy are one photo; the placeholder gif is not one
      imageUrls: [placeholder(9), placeholder(10)],
    });
    // A cabin takes no equipment
    expect(page.categories[0].equipmentIds).toEqual([]);
  });

  it('reads the type labels and the equipment names', () => {
    const page = readBookNowPage(busselton)!;
    expect([...page.types]).toEqual([
      ['5', 'Cabins'],
      ['2', 'Sites'],
    ]);
    expect(page.equipment.get('1')).toBe('Caravan with Awning');
    expect(page.equipment.get('11')).toBe('Car & Swag (with trailer)');
    expect(page.equipment.has('all')).toBe(false);
    expect(page.equipment.size).toBe(15);
  });

  it('reads the dated notices as plain text, list items as sentences', () => {
    const page = readBookNowPage(busselton)!;
    expect(page.notices.map((n) => [n.from, n.to, n.title])).toEqual([
      ['2026-12-19', '2027-01-31', 'School Holiday Bookings'],
      ['2026-09-25', '2026-10-10', ''],
      ['2027-09-24', '2027-10-09', 'School holiday bookings'],
    ]);
    expect(page.notices[2].text).toBe(
      'For the 2027 September school holiday period, from 24 September to 9 October 2027, the ' +
        'following booking parameters apply: 24/09 – 26/09: 3-night minimum stay on all ' +
        'accommodation categories with arrivals only permitted on 24/09. 27/09 – 09/10: 2-night ' +
        'minimum stay on all accommodation categories. Bookings will open for members on the 14 ' +
        'October 2026 and for non members on 16 October 2026. Visit our school holidays bookings ' +
        'page for more information on release times, terms, conditions and exclusions.'
    );
  });

  it('leaves out inactive categories and keeps the first of two with one id', () => {
    const page = readBookNowPage(
      [
        item({ 'data-cat-id': '1', 'data-active': 'false', 'data-title': 'Closed Cabin' }),
        item({ 'data-cat-id': '2', 'data-active': 'true', 'data-title': 'Powered Site' }),
        item({ 'data-cat-id': '2', 'data-active': 'true', 'data-title': 'Powered Site Again' }),
        item({ 'data-cat-id': '3', 'data-title': 'Studio Room' }),
      ].join('')
    )!;
    expect(page.categories.map((c) => [c.catId, c.title])).toEqual([
      ['2', 'Powered Site'],
      ['3', 'Studio Room'],
    ]);
  });

  it('gives no maxGuests for a guest count that is not a number, and reads data-title without a heading', () => {
    const page = readBookNowPage(
      [
        item({ 'data-cat-id': '1', 'data-title': 'A', 'data-max-guests': 'six' }),
        item({ 'data-cat-id': '2', 'data-title': 'B', 'data-max-guests': '' }),
        item({ 'data-cat-id': '3', 'data-title': 'C', 'data-max-guests': '0' }),
        item({ 'data-cat-id': '4', 'data-title': 'D', 'data-max-guests': '4' }),
      ].join('')
    )!;
    expect(page.categories.map((c) => c.maxGuests)).toEqual([undefined, undefined, undefined, 4]);
    expect(page.categories.map((c) => c.title)).toEqual(['A', 'B', 'C', 'D']);
    // No count of pets: none allowed
    expect(page.categories[0].maxPets).toBe(0);
  });

  it("keeps only https photos on NewBook's image host", () => {
    const gallery = (srcs: string[]) =>
      `<div class="accommodation-item__gallery">${srcs
        .map((src) => `<img src="${src}" alt="">`)
        .join('')}</div>`;
    const page = readBookNowPage(
      item(
        { 'data-cat-id': '1', 'data-title': 'Cabin' },
        gallery([
          'http://driveau.newbook.cloud/crop_800_450/a.jpg',
          'https://images.example.com/b.jpg',
          'https://driveau.newbook.cloud.example.com/c.jpg',
          'not a url',
          'https://driveau.newbook.cloud/crop_800_450/d.jpg',
        ])
      )
    )!;
    expect(page.categories[0].imageUrls).toEqual([
      'https://driveau.newbook.cloud/crop_800_450/d.jpg',
    ]);
  });

  it('turns the excerpt\'s "[...]" into an ellipsis and decodes entities', () => {
    const page = readBookNowPage(
      item(
        { 'data-cat-id': '1', 'data-title': 'Cabin' },
        '<div class="accommodation-item__description">It&rsquo;s a cabin &amp; more [...]</div>'
      )
    )!;
    expect(page.categories[0].description).toBe('It’s a cabin & more…');
  });

  it('is undefined for a page with no category (a redesign, or a native page)', () => {
    expect(readBookNowPage('<html><body><h1>Book now</h1></body></html>')).toBeUndefined();
    // The container and the tariffs are not categories
    expect(
      readBookNowPage(
        '<div class="accommodation-item-container"><div class="accommodation-item-tariffs"></div></div>'
      )
    ).toBeUndefined();
  });
});

describe('racImageUrl', () => {
  it(`accepts https on ${RAC_IMAGE_HOST} only`, () => {
    expect(racImageUrl(` ${placeholder(1)} `)).toBe(placeholder(1));
    expect(racImageUrl(undefined)).toBeUndefined();
    expect(racImageUrl('data:image/gif;base64,R0lGODlh')).toBeUndefined();
    expect(racImageUrl('https://parksandresorts.rac.com.au/a.jpg')).toBeUndefined();
  });
});
