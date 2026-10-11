/**
 * RendererEvents: events reach trusted, live webContents only, and are dropped without
 * error when there is no window.
 */

import { RendererEvents } from '@main/ipc/events';
import { TrustedWebContents } from '@main/ipc/trusted-web-contents';
import { logger } from '@main/utils/logger';
import { fakeWebContents } from '@tests/utils/ipc-harness';

describe('RendererEvents', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends only to registered webContents that are still alive', () => {
    const trusted = new TrustedWebContents();
    const main = fakeWebContents(1);
    const closed = fakeWebContents(2);
    const stranger = fakeWebContents(3); // never registered, e.g. a provider sign-in window
    trusted.register(main);
    trusted.register(closed);
    closed.destroy();

    new RendererEvents(trusted).emit('app:navigate', { path: '/watches/3' });

    expect(main.sent).toEqual([['app:navigate', { path: '/watches/3' }]]);
    expect(closed.sent).toEqual([]);
    expect(stranger.sent).toEqual([]);
    expect(trusted.isTrusted(1)).toBe(true);
    expect(trusted.isTrusted(2)).toBe(false);
    expect(trusted.isTrusted(3)).toBe(false);
  });

  it('drops events without error before a window exists, after it closes, or when send throws', () => {
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    const trusted = new TrustedWebContents();
    const events = new RendererEvents(trusted);

    expect(() => events.emit('updater:not-available', null)).not.toThrow();

    const closing = fakeWebContents(1);
    closing.send = () => {
      throw new Error('Object has been destroyed');
    };
    trusted.register(closing);
    expect(() => events.emit('updater:error', { error: 'offline' })).not.toThrow();

    closing.destroy();
    expect(trusted.list()).toEqual([]);
    expect(() => events.emit('updater:error', { error: 'offline' })).not.toThrow();
  });
});
