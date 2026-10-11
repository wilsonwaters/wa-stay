/**
 * Window Type Declaration
 * `window.api` is the preload's implementation of the IPC contract.
 */

import type { WindowApi } from '../shared/contracts';

declare global {
  interface Window {
    api: WindowApi;
  }
}

export {};
