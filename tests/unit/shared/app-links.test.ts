/**
 * The in-app paths a notification may open (U5): main checks them before `app:navigate`, the
 * renderer before it follows a notification's link.
 */
import { RelatedType } from '@shared/types/common.types';
import { isAppLinkPath, notificationLinkPath, relatedPath } from '@shared/utils/app-links';

describe('isAppLinkPath', () => {
  it.each(['/watches/12', '/site-sniper/7', '/bookings/3', '/settings/notifications'])(
    'allows %s (v1 links stay valid)',
    (path) => {
      expect(isAppLinkPath(path)).toBe(true);
    }
  );

  it.each([
    'https://evil.example',
    '//evil.example/watches/12',
    'javascript:alert(1)',
    'file:///etc/passwd',
    '#/watches/12',
    'watches/12',
    '/watches/12?next=https://evil.example',
    '/watches/12#x',
    '/watches/12/edit',
    '/watches/0',
    '/watches/-1',
    '/watches/abc',
    '/watches/',
    '/watches',
    '/settings',
    '/settings/Accounts',
    '/settings/../watches/1',
    '/places/parkstay/12',
    '/',
    '',
  ])('refuses %s', (path) => {
    expect(isAppLinkPath(path)).toBe(false);
  });

  it('refuses anything that is not a string', () => {
    expect(isAppLinkPath(undefined)).toBe(false);
    expect(isAppLinkPath(null)).toBe(false);
    expect(isAppLinkPath(12)).toBe(false);
    expect(isAppLinkPath({ toString: () => '/watches/12' })).toBe(false);
  });
});

describe('relatedPath and notificationLinkPath (the one mapping main and the renderer share)', () => {
  it('maps a watch, snipe or booking to its page', () => {
    expect(relatedPath(RelatedType.WATCH, 12)).toBe('/watches/12');
    expect(relatedPath(RelatedType.SNIPE, 7)).toBe('/site-sniper/7');
    expect(relatedPath(RelatedType.BOOKING, 3)).toBe('/bookings/3');
  });

  it('follows an allowed actionUrl, else the related page, else nothing', () => {
    expect(notificationLinkPath({ actionUrl: '/bookings/3' })).toBe('/bookings/3');
    expect(
      notificationLinkPath({
        actionUrl: 'https://evil.example',
        relatedType: RelatedType.SNIPE,
        relatedId: 7,
      })
    ).toBe('/site-sniper/7');
    expect(notificationLinkPath({ actionUrl: 'https://evil.example' })).toBeNull();
    // As a database row holds them: nulls
    expect(
      notificationLinkPath({ actionUrl: null, relatedType: null, relatedId: null })
    ).toBeNull();
  });

  it('refuses a related type it does not know, prototype keys included, and bad ids', () => {
    for (const relatedType of ['toString', '__proto__', 'constructor', 'stq']) {
      expect(
        notificationLinkPath({ relatedType: relatedType as RelatedType, relatedId: 12 })
      ).toBeNull();
    }
    for (const relatedId of [0, -1, 1.5, Number.NaN]) {
      expect(notificationLinkPath({ relatedType: RelatedType.WATCH, relatedId })).toBeNull();
    }
  });
});
