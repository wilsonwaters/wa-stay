/**
 * Single-instance lock: a losing instance quits; the running one brings its window forward
 * (restoring it if minimised), replays a launch that arrived before the window existed, and
 * ignores a `--hidden` duplicate login launch.
 */

import { EventEmitter } from 'events';
import { acquireSingleInstance, FrontableWindow } from '@main/app/single-instance';

function fakeApp(hasLock: boolean) {
  return Object.assign(new EventEmitter(), {
    requestSingleInstanceLock: jest.fn(() => hasLock),
    quit: jest.fn(),
  });
}

function fakeWindow(minimized = false): FrontableWindow & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isDestroyed: () => false,
    isMinimized: () => minimized,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  };
}

const log = { info: jest.fn() };

describe('acquireSingleInstance', () => {
  it('a losing instance quits and listens for nothing', () => {
    const app = fakeApp(false);

    const instance = acquireSingleInstance(app, { log });

    expect(instance.isPrimary).toBe(false);
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(app.listenerCount('second-instance')).toBe(0);
  });

  it('a second launch restores, shows and focuses the window; --hidden is ignored', () => {
    const app = fakeApp(true);
    const instance = acquireSingleInstance(app, { log });
    const window = fakeWindow(true);
    instance.attachWindow(window);

    expect(instance.isPrimary).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();

    app.emit('second-instance', {}, ['WA Stay.exe', '--hidden']);
    expect(window.calls).toEqual([]);

    app.emit('second-instance', {}, ['WA Stay.exe']);
    expect(window.calls).toEqual(['restore', 'show', 'focus']);
  });

  it('a launch before the window exists is remembered and replayed once the window is attached', () => {
    const app = fakeApp(true);
    const requestWindow = jest.fn();
    const instance = acquireSingleInstance(app, { log, requestWindow });

    app.emit('second-instance', {}, ['WA Stay.exe']);
    expect(requestWindow).toHaveBeenCalledTimes(1);

    const window = fakeWindow();
    instance.attachWindow(window);
    expect(window.calls).toEqual(['show', 'focus']);

    // Replayed once only
    const next = fakeWindow();
    instance.attachWindow(next);
    expect(next.calls).toEqual([]);
  });

  it('a closed window is forgotten: the next launch asks for a new one', () => {
    const app = fakeApp(true);
    const requestWindow = jest.fn();
    const instance = acquireSingleInstance(app, { log, requestWindow });
    const window = fakeWindow();
    instance.attachWindow(window);
    instance.attachWindow(null);

    app.emit('second-instance', {}, ['WA Stay.exe']);

    expect(window.calls).toEqual([]);
    expect(requestWindow).toHaveBeenCalledTimes(1);
  });
});
