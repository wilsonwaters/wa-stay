/**
 * RAC's park pages (`src/main/providers/rac/park-pages.ts`): each park's card photo from RAC's
 * parks page, and a park's own photos, intro and accommodation photos from its home page, on
 * the synthetic fixtures (made-up words and photo addresses, in the shape of the pages read on
 * 18 Oct 2026) and on small pages that show the edge cases: photos on another host, over http
 * or outside WordPress's uploads, a hero with no slide (its og:image), an intro's links,
 * scripts and images, a page in another shape.
 */

import fs from 'fs';
import path from 'path';
import {
  RAC_INTRO_MAX_PARAGRAPHS,
  RAC_PARKS_PAGE_PATH,
  racPhotoUrl,
  readParkHomePage,
  readParksPage,
} from '@main/providers/rac/park-pages';

const FIXTURES = path.join(__dirname, '../../../fixtures/providers/rac');
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const RAC = 'https://parksandresorts.rac.com.au';
const PAGE_URL = `${RAC}/busselton/`;
/** A park's own photo, made up, as the fixtures write it. */
const parkPhoto = (site: number, n: number) =>
  `${RAC}/wp-content/uploads/sites/${site}/0000/00/placeholder-${n}.jpg`;
const newbook = (n: number) =>
  `https://driveau.newbook.cloud/crop_800_450/instances_00000000000000000000000000000000_${n}.jpg`;

/** One item of RAC's parks grid. */
function gridItem(inner: string): string {
  return `<div class="park-grid-block__parks__item">${inner}</div>`;
}
const img = (attributes: string) => `<img class="park-grid-block__parks__item__img" ${attributes}>`;
const bookNow = (slug: string) => `<a href="/${slug}/book-now/">Check availability</a>`;

/** A park's home page with the given hero slides' photos, and anything after. */
function homePage(slides: string[], rest = ''): string {
  const items = slides
    .map((photo) => `<div class="large-park-hero-banner__slider__item" data-back="${photo}"></div>`)
    .join('');
  return `<div class="large-park-hero-banner__slider">${items}</div>${rest}`;
}
/** An intro: the h1 and what follows it, in one column. */
const intro = (inner: string) =>
  `<div class="wp-block-column"><h1>Welcome to the made-up park</h1>${inner}</div>`;
const descriptionOf = (inner: string) =>
  readParkHomePage(homePage([], intro(inner)), PAGE_URL).descriptionHtml;

describe('racPhotoUrl', () => {
  it.each([
    `${RAC}/wp-content/uploads/sites/6/2022/05/a-park-414x229.jpg`,
    `${RAC}/busselton/wp-content/uploads/sites/6/2022/05/a-park.JPEG`,
    `${RAC}/monkey-mia/wp-content/uploads/sites/2/2022/05/a-park.png`,
    `${RAC}/wp-content/uploads/sites/4/2026/10/a-park.webp`,
  ])('keeps a photo of WordPress on RAC: %s', (url) => {
    expect(racPhotoUrl(url)).toBe(new URL(url).href);
  });

  it.each([
    ['http', `http://parksandresorts.rac.com.au/wp-content/uploads/sites/6/a.jpg`],
    ['another host', 'https://example.com/wp-content/uploads/sites/6/a.jpg'],
    ['a sub-domain', 'https://cdn.parksandresorts.rac.com.au/wp-content/uploads/sites/6/a.jpg'],
    ["NewBook's image host", newbook(1)],
    ['another port', `https://parksandresorts.rac.com.au:8443/wp-content/uploads/a.jpg`],
    ['a user name', `https://someone@parksandresorts.rac.com.au/wp-content/uploads/a.jpg`],
    ["the theme's images", `${RAC}/wp-content/themes/parks-and-resorts/images/rac-logo.svg`],
    ['no image', `${RAC}/wp-content/uploads/sites/6/2022/05/terms.pdf`],
    ['under a deeper path', `${RAC}/a/b/wp-content/uploads/sites/6/a.jpg`],
    ['a relative address', '/wp-content/uploads/sites/6/a.jpg'],
    ['a data URI', 'data:image/png;base64,iVBORw0KGgo='],
    ['nothing', ''],
  ])('refuses %s', (_, url) => {
    expect(racPhotoUrl(url)).toBeUndefined();
  });

  it('refuses no value', () => {
    expect(racPhotoUrl(undefined)).toBeUndefined();
  });
});

describe('readParksPage', () => {
  it('reads RAC’s parks page, /bookings/', () => {
    expect(RAC_PARKS_PAGE_PATH).toBe('/bookings/');
  });

  it("gives every park in the fixture's grid its photo, by its slug, in the page's order", () => {
    const photos = readParksPage(fixture('parks-page.html'));
    expect([...photos]).toEqual([
      ['busselton', parkPhoto(6, 6)],
      ['cable-beach', parkPhoto(9, 9)],
      ['cervantes', parkPhoto(5, 5)],
      ['esperance', parkPhoto(10, 10)],
      ['exmouth', parkPhoto(3, 3)],
      ['karri-valley', parkPhoto(7, 7)],
      ['margaret-river', parkPhoto(8, 8)],
      ['monkey-mia', parkPhoto(2, 2)],
      ['ningaloo', parkPhoto(4, 4)],
    ]);
  });

  it('takes the lazy-loaded photo, else the noscript copy, never the placeholder', () => {
    const page = [
      gridItem(
        img(`src="data:image/png;base64,iVBORw0KGgo=" data-src="${parkPhoto(6, 1)}"`) +
          bookNow('busselton')
      ),
      gridItem(
        `${img('src="data:image/png;base64,iVBORw0KGgo="')}<noscript>${img(`src="${parkPhoto(9, 2)}"`)}</noscript>${bookNow('cable-beach')}`
      ),
    ].join('');
    expect([...readParksPage(page)]).toEqual([
      ['busselton', parkPhoto(6, 1)],
      ['cable-beach', parkPhoto(9, 2)],
    ]);
  });

  it('knows a park by its book-now link, relative or on RAC, never on another host', () => {
    const photo = `src="${parkPhoto(6, 1)}"`;
    const page = [
      gridItem(`${img(photo)}<a href="${RAC}/busselton/book-now/">Check</a>`),
      gridItem(`${img(photo)}<a href="https://example.com/cervantes/book-now/">Check</a>`),
      gridItem(`${img(photo)}<a href="/esperance/">More</a>`),
      gridItem(img(photo)),
      gridItem(`${img(photo)}<a href="/exmouth/info/">Info</a>${bookNow('exmouth')}`),
    ].join('');
    expect([...readParksPage(page).keys()]).toEqual(['busselton', 'exmouth']);
  });

  it('leaves out a park whose photo is not on RAC, and keeps the first of two items for a park', () => {
    const page = [
      gridItem(`${img(`src="${newbook(1)}"`)}${bookNow('busselton')}`),
      gridItem(
        `${img('src="http://parksandresorts.rac.com.au/wp-content/uploads/a.jpg"')}${bookNow('cervantes')}`
      ),
      gridItem(`${img(`src="${parkPhoto(5, 1)}"`)}${bookNow('cervantes')}`),
      gridItem(`${img(`src="${parkPhoto(5, 2)}"`)}${bookNow('cervantes')}`),
    ].join('');
    expect([...readParksPage(page)]).toEqual([['cervantes', parkPhoto(5, 1)]]);
  });

  it('reads nothing from a page with no parks grid (a redesign)', () => {
    expect(readParksPage('<html><body><h1>Book now</h1></body></html>').size).toBe(0);
    expect(readParksPage(fixture('park-home.html')).size).toBe(0);
  });
});

describe('readParkHomePage', () => {
  it("reads the fixture: the hero's photos, the intro with its link, and the accommodation photos", () => {
    expect(readParkHomePage(fixture('park-home.html'), PAGE_URL)).toEqual({
      photos: [parkPhoto(0, 1), parkPhoto(0, 2)],
      descriptionHtml:
        "<p>Made-up introduction, standing in for the park's own words on RAC's site. Its " +
        `<a href="${RAC}/busselton/contact-us/" target="_blank" rel="noopener noreferrer">` +
        "made-up link</a> reads against the park's page.</p>" +
        '<p>Made-up second paragraph, with <strong>made-up emphasis</strong> &amp; more.</p>',
      accommodationPhotos: [101, 102, 103, 104].map(newbook),
    });
  });

  it("reads the intro's relative links against the page's own address", () => {
    const page = readParkHomePage(fixture('park-home.html'), `${RAC}/monkey-mia/`);
    expect(page.descriptionHtml).toContain(`href="${RAC}/monkey-mia/contact-us/"`);
  });

  it("takes the og:image when the hero has no slide, and only RAC's photos either way", () => {
    const og = (url: string) => `<meta property="og:image" content="${url}">`;
    expect(readParkHomePage(og(parkPhoto(2, 1)), PAGE_URL).photos).toEqual([parkPhoto(2, 1)]);
    expect(
      readParkHomePage(homePage([parkPhoto(2, 2)], og(parkPhoto(2, 1))), PAGE_URL).photos
    ).toEqual([parkPhoto(2, 2)]);
    expect(readParkHomePage(og(newbook(1)), PAGE_URL).photos).toEqual([]);
    expect(
      readParkHomePage(
        homePage([
          newbook(1),
          'http://parksandresorts.rac.com.au/wp-content/uploads/a.jpg',
          parkPhoto(6, 3),
          parkPhoto(6, 3),
        ]),
        PAGE_URL
      ).photos
    ).toEqual([parkPhoto(6, 3)]);
  });

  it("keeps an accommodation photo only on NewBook's image host", () => {
    const gallery = `<div class="accommodation-and-sites-block__grid__item__gallery">
      <img src="data:image/png;base64,iVBORw0KGgo=" data-src="${newbook(7)}">
      <img src="${parkPhoto(6, 1)}"><img src="http://driveau.newbook.cloud/crop_800_450/a.jpg">
      <noscript><img src="${newbook(7)}"></noscript><img data-src="${newbook(8)}"></div>`;
    expect(readParkHomePage(gallery, PAGE_URL).accommodationPhotos).toEqual([
      newbook(7),
      newbook(8),
    ]);
  });

  it('keeps an intro paragraph’s text, links and emphasis, and nothing else', () => {
    expect(
      descriptionOf(
        '<p>Made-up <b>bold</b>, <i>italic</i>, <em>em</em>,<br>a <span class="x">span</span>' +
          '<img src="https://example.com/a.jpg" alt="A photo"> and <a href="javascript:alert(1)">a script link</a>, ' +
          '<a href="http://example.com/">an http link</a> and <a>no link</a>.</p>'
      )
    ).toBe(
      '<p>Made-up <strong>bold</strong>, <em>italic</em>, <em>em</em>,<br />a span and ' +
        'a script link, <a rel="noopener noreferrer">an http link</a> ' +
        'and no link.</p>'
    );
  });

  it("escapes a link's address, and never lets a script or style through", () => {
    expect(
      descriptionOf(
        '<p>Made-up <a href="https://example.com/?a=1&amp;b=&quot;2&quot;">link</a>' +
          '<script>alert(1)</script><style>p{}</style> &lt;script&gt;</p>'
      )
    ).toBe(
      '<p>Made-up <a href="https://example.com/?a=1&amp;b=%222%22" target="_blank" rel="noopener noreferrer">link</a> ' +
        '&lt;script&gt;</p>'
    );
  });

  it('takes the paragraphs after the h1 beside it, with text, at most eight', () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) => `<p>Made-up ${i + 1}.</p>`).join('');
    expect(descriptionOf(`<p>  </p><p>&nbsp;</p>${paragraphs}`)).toBe(
      Array.from({ length: RAC_INTRO_MAX_PARAGRAPHS }, (_, i) => `<p>Made-up ${i + 1}.</p>`).join(
        ''
      )
    );
    // Before the h1, or in another block, is not the intro
    const page = `<p>Before.</p>${intro('<div><p>Nested.</p></div><p>Made-up intro.</p>')}<p>After.</p>`;
    expect(readParkHomePage(page, PAGE_URL).descriptionHtml).toBe('<p>Made-up intro.</p>');
  });

  it('reads no intro from a page with no h1, or none followed by a paragraph', () => {
    expect(readParkHomePage('<p>Made-up words.</p>', PAGE_URL).descriptionHtml).toBeUndefined();
    expect(descriptionOf('<div>Made-up words.</div>')).toBeUndefined();
    expect(descriptionOf('<p> </p><p><img src="https://example.com/a.jpg"></p>')).toBeUndefined();
  });

  it('reads nothing at all from a page in another shape (a redesign)', () => {
    expect(readParkHomePage(fixture('book-now-busselton.html'), PAGE_URL)).toEqual({
      photos: [],
      accommodationPhotos: [],
    });
    expect(readParkHomePage('', PAGE_URL)).toEqual({ photos: [], accommodationPhotos: [] });
  });
});
