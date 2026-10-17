/**
 * RAC's cart page (`src/main/providers/rac/cart-page.ts`) on the synthetic cart fixtures,
 * written from RAC's NewBook scripts (`tests/fixtures/providers/rac/cart/`): `cart_breakdown`'s
 * nights and amount, NewBook's hold fields, the proxy path and the sidebar's items; a page with
 * no `cart_breakdown` is no cart page; the cart's dates; and the hold's expiry, from the page's
 * countdown, its minutes or the flagged 10-minute estimate.
 */

import fs from 'fs';
import path from 'path';
import {
  cartDate,
  cartExpiry,
  RAC_ESTIMATED_HOLD_MS,
  readCartPage,
} from '@main/providers/rac/cart-page';

const CART = path.join(__dirname, '../../../fixtures/providers/rac/cart');
const page = (file: string) => fs.readFileSync(path.join(CART, file), 'utf8');
const PROXY =
  'https://parksandresorts.rac.com.au/busselton/wp-content/themes/parks-and-resorts/inc/newbook/api/rac-busselton-holiday-park.php?';
const NOW = new Date('2026-10-17T02:00:00.000Z');
const POWERED = {
  offset: '0',
  category: 'Powered Site',
  arrival: '2026-11-06',
  departure: '2026-11-08',
};

describe('readCartPage', () => {
  it('an empty cart: no nights, no amount, no items, and the proxy path', () => {
    expect(readCartPage(page('cart-page-empty.html'))).toEqual({
      bookingNights: 0,
      amount: 0,
      holdIds: [],
      newbookApiPath: PROXY,
      items: [],
    });
  });

  it('a cart holding one stay, with its hold fields and its item', () => {
    expect(readCartPage(page('cart-page-one-stay.html'))).toEqual({
      bookingNights: 2,
      amount: 150,
      holdIds: ['501'],
      earliestHoldExpiresWhen: 900,
      defaultHoldDuration: 20,
      newbookApiPath: PROXY,
      items: [POWERED],
    });
  });

  it('a cart with no hold fields', () => {
    expect(readCartPage(page('cart-page-no-hold-fields.html'))).toEqual(
      expect.objectContaining({ bookingNights: 2, amount: 150, holdIds: [], items: [POWERED] })
    );
    expect(readCartPage(page('cart-page-no-hold-fields.html'))).not.toHaveProperty(
      'earliestHoldExpiresWhen'
    );
  });

  it('a cart RAC refused: no nights', () => {
    expect(readCartPage(page('cart-page-refused.html'))).toEqual(
      expect.objectContaining({ bookingNights: 0, amount: 0, items: [] })
    );
  });

  it('a cart holding two stays: both items, by their offsets', () => {
    const cart = readCartPage(page('cart-page-two-stays.html'));
    expect(cart?.bookingNights).toBe(4);
    expect(cart?.holdIds).toEqual(['502', '501']);
    expect(cart?.items).toEqual([
      { ...POWERED, category: 'Two Bedroom Cabin (Sleeps 4)' },
      { ...POWERED, offset: '1' },
    ]);
  });

  it('sums every cart step, as NewBook does, and reads text numbers', () => {
    const html =
      'var cart_breakdown = {"Online\\\\Step\\\\Booking":{"amount":"150.50","totalBookingNights":"2"},' +
      '"Online\\\\Step\\\\Product":{"amount":10}};';
    expect(readCartPage(html)).toEqual(
      expect.objectContaining({ bookingNights: 2, amount: 160.5 })
    );
  });

  it('a page with no cart_breakdown, or one that is not JSON, is no cart page', () => {
    expect(readCartPage('<html><title>Just a moment...</title></html>')).toBeUndefined();
    expect(readCartPage('var cart_breakdown = {not json};')).toBeUndefined();
    expect(readCartPage('var cart_breakdown = [1, 2];')).toBeUndefined();
  });

  it('an item whose dates or category it cannot read keeps only what it can', () => {
    const html = page('cart-page-one-stay.html')
      .replace('Sun 8 Nov 2026', 'soon')
      .replace('<span class="sidebar_category_name">Powered Site</span>', '');
    expect(readCartPage(html)?.items).toEqual([{ offset: '0', arrival: '2026-11-06' }]);
  });
});

describe('cartDate', () => {
  it.each([
    ['Fri 6 Nov 2026', '2026-11-06'],
    ['6 November 2026', '2026-11-06'],
    ['Sunday, 8th Nov 2026', '2026-11-08'],
    ['06/11/2026', '2026-11-06'],
    ['2026-11-06', '2026-11-06'],
  ])('%s is %s', (text, date) => {
    expect(cartDate(text)).toBe(date);
  });

  it.each(['soon', '31 Feb 2026', '6 Foo 2026', '32/01/2026'])('%s is no date', (text) => {
    expect(cartDate(text)).toBeUndefined();
  });
});

describe('cartExpiry', () => {
  const at = (ms: number) => new Date(NOW.getTime() + ms);
  const estimate = { expiresAt: at(RAC_ESTIMATED_HOLD_MS), estimated: true };

  it('the seconds left, when the page holds items', () => {
    expect(cartExpiry({ holdIds: ['1'], earliestHoldExpiresWhen: 900 }, NOW)).toEqual({
      expiresAt: at(900_000),
      estimated: false,
    });
  });

  it("the hold's length in minutes, when the page holds items but gives no seconds", () => {
    expect(cartExpiry({ holdIds: ['1'], defaultHoldDuration: 20 }, NOW)).toEqual({
      expiresAt: at(20 * 60_000),
      estimated: false,
    });
  });

  it.each([
    ['no hold fields', { holdIds: [] }],
    [
      'no held item, with times',
      { holdIds: [], earliestHoldExpiresWhen: 900, defaultHoldDuration: 20 },
    ],
    ['0 seconds', { holdIds: ['1'], earliestHoldExpiresWhen: 0, defaultHoldDuration: 20 }],
    ['negative seconds', { holdIds: ['1'], earliestHoldExpiresWhen: -5 }],
    ['more than a day', { holdIds: ['1'], earliestHoldExpiresWhen: 86_401 }],
    ['minutes over a day', { holdIds: ['1'], defaultHoldDuration: 1_441 }],
    ['0 minutes', { holdIds: ['1'], defaultHoldDuration: 0 }],
  ])('%s: 10 minutes, flagged as an estimate', (_case, fields) => {
    expect(cartExpiry(fields, NOW)).toEqual(estimate);
  });

  it('a day exactly is still an answer', () => {
    expect(cartExpiry({ holdIds: ['1'], earliestHoldExpiresWhen: 86_400 }, NOW).estimated).toBe(
      false
    );
  });
});
