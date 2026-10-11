import { updateCheckMessage } from './updateCheckMessage';

describe('updateCheckMessage', () => {
  it.each([
    [{ status: { state: 'not-available' as const } }, "You're up to date"],
    [{ status: { state: 'available' as const, version: '2.1.0' } }, 'Version 2.1.0 is available'],
    [
      { status: { state: 'downloading' as const, version: '2.1.0' } },
      'Version 2.1.0 is downloading',
    ],
    [
      { status: { state: 'downloaded' as const }, latest: '2.1.0' },
      'Version 2.1.0 is ready to install',
    ],
    [
      { status: { state: 'error' as const, error: 'net::ERR_INTERNET_DISCONNECTED' } },
      "Couldn't check for updates: net::ERR_INTERNET_DISCONNECTED",
    ],
    [{ status: { state: 'idle' as const }, latest: '2.1.0' }, 'Version 2.1.0 is available'],
    [{ status: { state: 'idle' as const }, latest: '2.0.0' }, "You're up to date"],
  ])('%j reads "%s"', (outcome, message) => {
    expect(updateCheckMessage(outcome, '2.0.0')).toBe(message);
  });
});
