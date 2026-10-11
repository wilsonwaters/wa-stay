/**
 * Crash policy (tech-review #9). One throw in a snipe timer must not end every snipe.
 *
 * - **During startup** (until `markReady`): an uncaught exception, an unhandled rejection or
 *   a failed start is logged, shown in an error box, and the app exits with code 1. A half
 *   started app is worse than none.
 * - **After startup**: uncaught exceptions and unhandled rejections are logged with their
 *   stack and the app keeps running. The user gets at most one error notification per
 *   10 minutes, so a burst of failures (every poll failing) cannot flood them.
 * - **Renderer crash**: `render-process-gone` is logged and the window is reloaded once.
 *
 * Log records carry `crash: 'exception' | 'rejection'`, which routes them to
 * `exceptions.log` / `rejections.log` (`utils/logger.ts`).
 */

import type { CrashKind } from '../utils/logger';

export const NOTIFY_INTERVAL_MS = 10 * 60 * 1000;

interface Log {
  error(message: string, meta?: Record<string, unknown>): unknown;
}

/** The `process` events the policy listens to (a fake emitter in tests). */
export interface ProcessEvents {
  on(event: 'uncaughtException', listener: (error: unknown) => void): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
}

export interface CrashPolicyOptions {
  process: ProcessEvents;
  app: { exit(code: number): void };
  dialog: { showErrorBox(title: string, content: string): void };
  log: Log;
  /** Clock for the notification throttle. Defaults to `Date.now`. */
  now?: () => number;
}

/** Tells the user about an error after startup (e.g. through `NotificationService`). */
export type ErrorNotifier = (error: Error) => unknown;

export interface CrashPolicy {
  /** Startup is complete: from now on errors are logged, notified (throttled) and survived. */
  markReady(notify: ErrorNotifier): void;
  /** Startup failed: log, show an error box, exit with code 1. */
  failStartup(error: unknown): void;
}

export function installCrashPolicy({
  process,
  app,
  dialog,
  log,
  now = Date.now,
}: CrashPolicyOptions): CrashPolicy {
  let notify: ErrorNotifier | null = null;
  let lastNotifiedAt: number | null = null;
  let exiting = false;

  const failStartup = (reason: unknown): void => {
    if (exiting) return;
    exiting = true;
    const error = toError(reason);
    log.error(`Startup failed: ${error.message}`, { stack: error.stack });
    try {
      dialog.showErrorBox(
        'The app could not start',
        `${error.message}\n\nDetails are in the log files.`
      );
    } catch {
      // No dialog available: the log line above still records why
    }
    app.exit(1);
  };

  const notifyThrottled = (error: Error): void => {
    if (!notify) return;
    const at = now();
    if (lastNotifiedAt !== null && at - lastNotifiedAt < NOTIFY_INTERVAL_MS) return;
    lastNotifiedAt = at;
    try {
      Promise.resolve(notify(error)).catch((notifyError: unknown) =>
        logNotifyFailure(log, notifyError)
      );
    } catch (notifyError) {
      logNotifyFailure(log, notifyError);
    }
  };

  const onError =
    (kind: CrashKind) =>
    (reason: unknown): void => {
      const error = toError(reason);
      const what = kind === 'exception' ? 'Uncaught exception' : 'Unhandled promise rejection';
      log.error(`${what}: ${error.message}`, { crash: kind, stack: error.stack });

      if (!notify) {
        failStartup(error);
        return;
      }
      notifyThrottled(error);
    };

  process.on('uncaughtException', onError('exception'));
  process.on('unhandledRejection', onError('rejection'));

  return {
    markReady(notifier) {
      notify = notifier;
    },
    failStartup,
  };
}

/** The part of `webContents` the renderer-crash handling uses. */
export interface RenderProcessTarget {
  on(
    event: 'render-process-gone',
    listener: (event: unknown, details: { reason: string; exitCode: number }) => void
  ): unknown;
  isDestroyed(): boolean;
  reload(): void;
}

/** Logs every renderer crash and reloads the window once (never in a loop). */
export function reloadOnceOnRenderCrash(contents: RenderProcessTarget, log: Log): void {
  let reloaded = false;
  contents.on('render-process-gone', (_event, { reason, exitCode }) => {
    log.error(`Renderer process gone: ${reason} (exit code ${exitCode})`);
    if (reason === 'clean-exit' || contents.isDestroyed()) return;
    if (reloaded) {
      log.error('The renderer crashed again; not reloading the window a second time');
      return;
    }
    reloaded = true;
    contents.reload();
  });
}

function toError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  return new Error(typeof reason === 'string' ? reason : safeString(reason));
}

function safeString(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function logNotifyFailure(log: Log, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  log.error(`Could not show the error notification: ${message}`);
}
