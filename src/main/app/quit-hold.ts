/**
 * The quit hold (V7). When the app quits, the providers' browsers get a bounded time to
 * close, so a browser profile is flushed rather than killed with the app.
 *
 * The first `before-quit`:
 * 1. hides every window, so nobody keeps using an app that is shutting down;
 * 2. runs `shutDown` (`AppContainer.dispose`), which cuts the renderer off, aborts the
 *    scheduler's jobs and starts closing the providers at once, closes the database once the
 *    jobs have settled (at most `SCHEDULER_STOP_GRACE_MS`, 3 s), and resolves once every
 *    browser has closed;
 * 3. holds the quit (`preventDefault`) until that resolves or `graceMs` passes, whichever
 *    is first, and then quits again.
 *
 * A `before-quit` during the hold is held too. The quit the hold sends at the end goes
 * through.
 */

/** The longest a quit waits for providers to close their browsers (each takes at most 5 s). */
export const QUIT_GRACE_MS = 6_000;

/** The part of Electron's `app` the hold uses. */
export interface QuitHoldApp {
  on(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): unknown;
  quit(): void;
}

/** The part of a `BrowserWindow` the hold uses. */
export interface HideableWindow {
  isDestroyed(): boolean;
  hide(): void;
}

export interface QuitHoldOptions {
  app: QuitHoldApp;
  /** Every window (`BrowserWindow.getAllWindows`). */
  windows: () => HideableWindow[];
  /**
   * Starts the shutdown and returns a promise that settles when it is done, or `null` when
   * there is nothing to shut down (startup has not finished).
   */
  shutDown: () => Promise<void> | null;
  log: { info(message: string): unknown; warn(message: string): unknown };
  graceMs?: number;
}

export function installQuitHold({
  app,
  windows,
  shutDown,
  log,
  graceMs = QUIT_GRACE_MS,
}: QuitHoldOptions): void {
  let phase: 'running' | 'holding' | 'done' = 'running';

  app.on('before-quit', (event) => {
    if (phase === 'done') return;
    if (phase === 'holding') {
      event.preventDefault();
      return;
    }

    for (const window of windows()) {
      if (!window.isDestroyed()) window.hide();
    }

    const shuttingDown = shutDown();
    if (!shuttingDown) {
      phase = 'done';
      return;
    }
    phase = 'holding';
    event.preventDefault();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const grace = new Promise<'grace'>((resolve) => {
      timer = setTimeout(() => resolve('grace'), graceMs);
    });
    const done = shuttingDown.then(
      () => 'done' as const,
      () => 'done' as const
    );
    void Promise.race([done, grace]).then((outcome) => {
      clearTimeout(timer);
      if (outcome === 'grace') {
        log.warn(`Quitting after ${graceMs / 1000} s without waiting for every browser to close`);
      }
      log.info('Application shut down successfully');
      phase = 'done';
      app.quit();
    });
  });
}
