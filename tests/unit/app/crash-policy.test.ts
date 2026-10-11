/**
 * Crash policy, driven through a fake `process` emitter:
 * - after startup a throw or rejection is logged with its stack, notified at most once per
 *   10 minutes, and never quits the app;
 * - during startup it shows an error box and exits with code 1;
 * - a crashed renderer is reloaded once.
 */

import { EventEmitter } from 'events';
import {
  installCrashPolicy,
  NOTIFY_INTERVAL_MS,
  reloadOnceOnRenderCrash,
} from '@main/app/crash-policy';

function setup() {
  const proc = new EventEmitter();
  const app = { exit: jest.fn(), quit: jest.fn() };
  const dialog = { showErrorBox: jest.fn() };
  const log = { error: jest.fn() };
  let now = 1_000_000;
  const clock = {
    advance: (ms: number) => {
      now += ms;
    },
  };
  const policy = installCrashPolicy({ process: proc, app, dialog, log, now: () => now });
  return { proc, app, dialog, log, clock, policy };
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('crash policy after startup', () => {
  it('a throw is logged with its stack, notified once, and does not quit or exit', async () => {
    const { proc, app, dialog, log, policy } = setup();
    const notify = jest.fn().mockResolvedValue(undefined);
    policy.markReady(notify);

    const error = new Error('snipe timer blew up');
    proc.emit('uncaughtException', error);
    await flush();

    expect(log.error).toHaveBeenCalledWith('Uncaught exception: snipe timer blew up', {
      crash: 'exception',
      stack: error.stack,
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(error);
    expect(app.quit).not.toHaveBeenCalled();
    expect(app.exit).not.toHaveBeenCalled();
    expect(dialog.showErrorBox).not.toHaveBeenCalled();
  });

  it('a second error within 10 minutes is logged but not notified; after 10 minutes it is', () => {
    const { proc, log, clock, policy } = setup();
    const notify = jest.fn();
    policy.markReady(notify);

    proc.emit('uncaughtException', new Error('first'));
    clock.advance(NOTIFY_INTERVAL_MS - 1);
    proc.emit('unhandledRejection', new Error('second'));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledTimes(2);

    clock.advance(1);
    proc.emit('unhandledRejection', 'a plain string reason');
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1][0]).toEqual(new Error('a plain string reason'));
    expect(log.error).toHaveBeenLastCalledWith(
      'Unhandled promise rejection: a plain string reason',
      expect.objectContaining({ crash: 'rejection' })
    );
  });

  it('a burst of errors (every poll failing) produces one notification and returns quickly', () => {
    const { proc, app, policy } = setup();
    const notify = jest.fn();
    policy.markReady(notify);

    const started = Date.now();
    for (let i = 0; i < 500; i++) proc.emit('unhandledRejection', new Error(`poll ${i} failed`));

    expect(Date.now() - started).toBeLessThan(1000);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(app.exit).not.toHaveBeenCalled();
  });

  it('a failing notification is logged, never escalated', async () => {
    const { proc, app, log, policy } = setup();
    policy.markReady(() => Promise.reject(new Error('no profile')));

    proc.emit('uncaughtException', new Error('boom'));
    await flush();

    expect(log.error).toHaveBeenLastCalledWith('Could not show the error notification: no profile');
    expect(app.exit).not.toHaveBeenCalled();

    const throwing = setup();
    throwing.policy.markReady(() => {
      throw new Error('sync failure');
    });
    expect(() => throwing.proc.emit('uncaughtException', new Error('boom'))).not.toThrow();
    expect(throwing.app.exit).not.toHaveBeenCalled();
  });
});

describe('crash policy during startup', () => {
  it('an uncaught exception before ready shows an error box and exits with code 1', () => {
    const { proc, app, dialog, log } = setup();

    proc.emit('uncaughtException', new Error('cannot open database'));

    expect(log.error).toHaveBeenCalledWith(
      'Uncaught exception: cannot open database',
      expect.objectContaining({ crash: 'exception' })
    );
    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      'The app could not start',
      expect.stringContaining('cannot open database')
    );
    expect(app.exit).toHaveBeenCalledWith(1);
    // The error box comes before the exit
    expect(dialog.showErrorBox.mock.invocationCallOrder[0]).toBeLessThan(
      app.exit.mock.invocationCallOrder[0]
    );
  });

  it('failStartup logs, shows an error box and exits 1, once, even if the dialog fails', () => {
    const { app, dialog, log, policy } = setup();
    dialog.showErrorBox.mockImplementation(() => {
      throw new Error('no display');
    });

    policy.failStartup(new Error('migration 7 failed'));
    policy.failStartup(new Error('again'));

    expect(log.error).toHaveBeenCalledWith('Startup failed: migration 7 failed', {
      stack: expect.stringContaining('migration 7 failed'),
    });
    expect(app.exit).toHaveBeenCalledTimes(1);
    expect(app.exit).toHaveBeenCalledWith(1);
  });
});

describe('reloadOnceOnRenderCrash', () => {
  function contents() {
    return Object.assign(new EventEmitter(), {
      isDestroyed: jest.fn(() => false),
      reload: jest.fn(),
    });
  }

  it('logs every crash and reloads the window once', () => {
    const target = contents();
    const log = { error: jest.fn() };
    reloadOnceOnRenderCrash(target, log);

    target.emit('render-process-gone', {}, { reason: 'oom', exitCode: 5 });
    target.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 11 });

    expect(target.reload).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith('Renderer process gone: oom (exit code 5)');
    expect(log.error).toHaveBeenCalledWith('Renderer process gone: crashed (exit code 11)');
  });

  it('does not reload after a clean exit or once the webContents is destroyed', () => {
    const target = contents();
    reloadOnceOnRenderCrash(target, { error: jest.fn() });

    target.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
    target.isDestroyed.mockReturnValue(true);
    target.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 11 });

    expect(target.reload).not.toHaveBeenCalled();
  });
});
