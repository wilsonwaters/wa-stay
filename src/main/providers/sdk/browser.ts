/**
 * `BrowserAutomation`: drives the installed Edge or Chrome for providers that have no API
 * (brief D5). `PlaywrightBrowserAutomation` (`browser-automation.ts`) implements it on
 * `playwright-core`, and every provider's context gets one.
 */

import type { Page } from 'playwright-core';

export interface BrowserAvailability {
  available: boolean;
  /** The browser channel that works, e.g. `msedge` or `chrome`. */
  channel?: string;
  /** Why it is unavailable: a `BrowserUnavailableReason`. */
  reason?: string;
}

export interface WithPageOptions {
  /** Show the browser window, for steps a person must do. Default false. */
  headed?: boolean;
  /** Default timeout for page actions and navigation. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface BrowserAutomation {
  isAvailable(): Promise<BrowserAvailability>;
  /** Opens a page, runs `fn`, and always closes the page. */
  withPage<T>(fn: (page: Page) => Promise<T>, options?: WithPageOptions): Promise<T>;
  close(): Promise<void>;
}
