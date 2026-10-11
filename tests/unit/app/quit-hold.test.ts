/**
 * The quit hold (`src/main/app/quit-hold.ts`): the first `before-quit` hides every window,
 * shuts down, and holds the quit until the providers' browsers have closed, never longer
 * than the grace period, also when a browser hangs on close.
 */

jest.mock('playwright-core', () =>
  jest.requireActual('@tests/utils/fake-playwright').fakePlaywrightModule()
);

import { EventEmitter } from 'events';
import { installQuitHold, QUIT_GRACE_MS, type HideableWindow } from '@main/app/quit-hold';
import { BROWSER_CLOSE_TIMEOUT_MS } from '@main/providers/sdk';
import { ProviderRegistry } from '@main/providers/registry';
import { fakePlaywright } from '@tests/utils/fake-playwright';
import {
  createFakeProvider,
  createPlaywrightTestProviderContext,
  createTestProviderContext,
} from '@tests/utils/fake-provider';

/** Electron's `app` for `before-quit`: a quit emits it, and goes ahead unless prevented. */
class FakeApp extends EventEmitter {
  readonly order: string[];
  /** Quits that went ahead. */
  quitted = 0;

  constructor(order: string[]) {
    super();
    this.order = order;
  }

  quit(): void {
    this.order.push('quit');
    let prevented = false;
    this.emit('before-quit', { preventDefault: () => (prevented = true) });
    if (!prevented) this.quitted++;
  }
}

function fakeWindow(order: string[], name: string): HideableWindow & { hide: jest.Mock } {
  return { isDestroyed: () => false, hide: jest.fn(() => order.push(`hide ${name}`)) };
}

const log = { info: jest.fn(), warn: jest.fn() };

function setup(shutDown: () => Promise<void> | null) {
  const order: string[] = [];
  const app = new FakeApp(order);
  const windows = [fakeWindow(order, 'main'), fakeWindow(order, 'about')];
  const destroyed = { isDestroyed: () => true, hide: jest.fn() };
  installQuitHold({
    app,
    windows: () => [...windows, destroyed],
    shutDown: () => {
      order.push('shutDown');
      return shutDown();
    },
    log,
  });
  return { app, order, windows, destroyed };
}

beforeEach(() => {
  jest.useFakeTimers();
  fakePlaywright.reset();
  log.info.mockClear();
  log.warn.mockClear();
});

/** Set by a test that pins `process.platform`. */
let restorePlatform: (() => void) | undefined;

afterEach(() => {
  restorePlatform?.();
  restorePlatform = undefined;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('installQuitHold', () => {
  it('hides every window before shutting down, holds the quit, and quits once shut down', async () => {
    let finish!: () => void;
    const { app, order, destroyed } = setup(() => new Promise<void>((r) => (finish = r)));

    app.quit();

    expect(order).toEqual(['quit', 'hide main', 'hide about', 'shutDown']);
    expect(destroyed.hide).not.toHaveBeenCalled();
    expect(app.quitted).toBe(0);

    finish();
    await jest.advanceTimersByTimeAsync(0);
    // The hold quits again, and that quit goes through without a second shutdown.
    expect(order).toEqual(['quit', 'hide main', 'hide about', 'shutDown', 'quit']);
    expect(app.quitted).toBe(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('holds a second quit during the hold as well', async () => {
    let finish!: () => void;
    const { app, order } = setup(() => new Promise<void>((r) => (finish = r)));

    app.quit();
    app.quit();
    expect(app.quitted).toBe(0);
    expect(order.filter((step) => step === 'shutDown')).toHaveLength(1);

    finish();
    await jest.advanceTimersByTimeAsync(0);
    expect(app.quitted).toBe(1);
  });

  it('lets the quit through at once when there is nothing to shut down', () => {
    const { app, order } = setup(() => null);
    app.quit();
    expect(app.quitted).toBe(1);
    expect(order).toEqual(['quit', 'hide main', 'hide about', 'shutDown']);
  });

  it('a browser that hangs on close: the hold ends when it is killed at 5 s, within the grace', async () => {
    // The POSIX kill path (Windows uses taskkill, covered in browser-automation's tests).
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    restorePlatform = () => Object.defineProperty(process, 'platform', platform);
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const registry = new ProviderRegistry();
    const fake = createFakeProvider({ id: 'fake' });
    registry.register(fake.factory, (manifest) => createPlaywrightTestProviderContext(manifest));
    await fake.ctx!.browser.withPage(async () => undefined);
    const [context] = fakePlaywright.contexts;
    context.hangOnClose = true;
    const { app } = setup(() => registry.disposeAll());

    app.quit();
    await jest.advanceTimersByTimeAsync(BROWSER_CLOSE_TIMEOUT_MS - 1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(app.quitted).toBe(0);

    await jest.advanceTimersByTimeAsync(1);
    expect(kill).toHaveBeenCalledWith(-context.pid, 'SIGKILL');
    expect(app.quitted).toBe(1);
    expect(BROWSER_CLOSE_TIMEOUT_MS).toBeLessThan(QUIT_GRACE_MS);
  });

  it('a shutdown that never finishes (a browser that cannot be killed): quits after the grace period', async () => {
    const registry = new ProviderRegistry();
    const fake = createFakeProvider({ id: 'fake' });
    registry.register(fake.factory, (manifest) => createTestProviderContext(manifest));
    jest.spyOn(fake.ctx!.browser, 'close').mockReturnValue(new Promise<void>(() => undefined));
    const { app, windows } = setup(() => registry.disposeAll());

    app.quit();
    expect(windows.every((window) => window.hide.mock.calls.length === 1)).toBe(true);

    await jest.advanceTimersByTimeAsync(QUIT_GRACE_MS - 1);
    expect(app.quitted).toBe(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(app.quitted).toBe(1);
    expect(log.warn).toHaveBeenCalledWith(
      'Quitting after 6 s without waiting for every browser to close'
    );
  });
});
