import { RelatedType } from '../../../shared/types/common.types';
import { ROUTES } from '../../app/routes';
import { notificationLink } from './deepLink';

describe('notificationLink', () => {
  it.each([
    ['/watches/12', '/watches/12'],
    ['/site-sniper/7', '/site-sniper/7'],
    ['/bookings/3', '/bookings/3'],
    ['/settings/notifications', '/settings/notifications'],
  ])('follows an allowed actionUrl %s (v1 links stay valid)', (actionUrl, expected) => {
    expect(notificationLink({ actionUrl })).toBe(expected);
  });

  it.each([
    [RelatedType.WATCH, 12, '/watches/12'],
    [RelatedType.SNIPE, 7, '/site-sniper/7'],
    [RelatedType.BOOKING, 3, '/bookings/3'],
  ])(
    'derives the %s page from relatedType and relatedId when there is no actionUrl',
    (relatedType, relatedId, expected) => {
      expect(notificationLink({ relatedType, relatedId })).toBe(expected);
    }
  );

  it('prefers the related page over an actionUrl that is not allowed', () => {
    expect(
      notificationLink({
        actionUrl: '/watches/12/edit',
        relatedType: RelatedType.SNIPE,
        relatedId: 7,
      })
    ).toBe('/site-sniper/7');
  });

  it.each([
    'https://evil.example',
    'http://localhost:5173/#/watches/12',
    'javascript:alert(1)',
    '//evil.example',
    '/watches/12?next=https://evil.example',
  ])('never links to %s', (actionUrl) => {
    expect(notificationLink({ actionUrl })).toBeNull();
  });

  it('has no link for an app-wide notification or a bad related id', () => {
    expect(notificationLink({})).toBeNull();
    expect(notificationLink({ relatedType: RelatedType.WATCH })).toBeNull();
    expect(notificationLink({ relatedType: RelatedType.WATCH, relatedId: 0 })).toBeNull();
    expect(notificationLink({ relatedType: RelatedType.WATCH, relatedId: 1.5 })).toBeNull();
  });

  it("derives the same paths as the renderer's ROUTES", () => {
    expect(notificationLink({ relatedType: RelatedType.WATCH, relatedId: 12 })).toBe(
      ROUTES.watchDetail(12)
    );
    expect(notificationLink({ relatedType: RelatedType.SNIPE, relatedId: 7 })).toBe(
      ROUTES.snipeDetail(7)
    );
    expect(notificationLink({ relatedType: RelatedType.BOOKING, relatedId: 3 })).toBe(
      ROUTES.bookingDetail(3)
    );
    expect(notificationLink({ actionUrl: ROUTES.settings('notifications') })).toBe(
      '/settings/notifications'
    );
  });
});
