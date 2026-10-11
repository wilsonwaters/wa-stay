import { badgeText, bellLabel } from './bellLabel';

describe('bell label and badge', () => {
  it('names the bell with the unread count, or plainly when nothing is unread', () => {
    expect(bellLabel(23)).toBe('Notifications, 23 unread');
    expect(bellLabel(1)).toBe('Notifications, 1 unread');
    expect(bellLabel(0)).toBe('Notifications');
  });

  it('caps the badge at 99+ and shows none at zero', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(7)).toBe('7');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
    expect(badgeText(4321)).toBe('99+');
  });
});
