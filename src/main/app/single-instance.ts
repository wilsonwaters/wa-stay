/**
 * Single-instance lock (tech-review #4). Two instances would run two schedulers against one
 * database, so the lock is taken before any database or scheduler work. A losing instance
 * quits at once; the running one brings its window to the front instead.
 *
 * A launch that arrives before the window exists (during startup) is remembered and
 * replayed when the window is attached. A launch with `--hidden` (a duplicate login item)
 * never shows the window.
 */

/** The command-line flag a login-item launch carries. */
export const HIDDEN_ARG = '--hidden';

/** The part of Electron's `app` this module uses. */
export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  on(event: 'second-instance', listener: (event: unknown, argv: string[]) => void): unknown;
  quit(): void;
}

/** The part of a `BrowserWindow` a second launch brings to the front. */
export interface FrontableWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

interface Log {
  info(message: string): unknown;
}

export interface SingleInstanceOptions {
  log: Log;
  /**
   * Called when a launch asks for the window and none is attached, e.g. on macOS after the
   * window was closed. During startup it may do nothing: the request is replayed when
   * startup attaches the window.
   */
  requestWindow?: () => void;
}

export interface SingleInstance {
  /** False when another instance holds the lock. This one is already quitting: start nothing. */
  readonly isPrimary: boolean;
  /** The window a later launch brings to the front (null once it is closed). */
  attachWindow(window: FrontableWindow | null): void;
}

/**
 * Restores a minimised window, shows a hidden one and focuses it: for a second launch, and for
 * a click on a desktop notification.
 */
export function bringToFront(target: FrontableWindow): void {
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
}

export function acquireSingleInstance(
  app: SingleInstanceApp,
  { log, requestWindow }: SingleInstanceOptions
): SingleInstance {
  if (!app.requestSingleInstanceLock()) {
    log.info('Another instance is already running; handing over to it and quitting');
    app.quit();
    return { isPrimary: false, attachWindow: () => undefined };
  }

  let window: FrontableWindow | null = null;
  let showRequested = false;

  app.on('second-instance', (_event, argv) => {
    if (argv.includes(HIDDEN_ARG)) {
      log.info('Ignored a second launch with --hidden');
      return;
    }
    if (window && !window.isDestroyed()) {
      bringToFront(window);
      return;
    }
    showRequested = true;
    requestWindow?.();
  });

  return {
    isPrimary: true,
    attachWindow(next) {
      window = next;
      if (window && showRequested) {
        showRequested = false;
        bringToFront(window);
      }
    },
  };
}
