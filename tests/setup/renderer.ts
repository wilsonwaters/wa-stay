/**
 * Setup for the `renderer` Jest project (testEnvironment: jsdom).
 *
 * Runs as a `setupFilesAfterEnv` entry, once per test file, before the test file loads.
 */

import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'util';
import { createMockWindowApi } from '../utils/window-api';

// React Router creates a TextEncoder when it loads; jest-environment-jsdom 30 (jsdom 26) has
// none. Node's are the same WHATWG classes.
if (typeof globalThis.TextEncoder === 'undefined') {
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

function installMockWindowApi(): void {
  Object.defineProperty(window, 'api', {
    value: createMockWindowApi(),
    configurable: true,
    writable: true,
  });
}

// Installed now, so modules that touch `window.api` at import find it, and again before
// every test, so stubs never leak from one test into the next. No method is stubbed:
// calling one rejects with an error naming it. Stub what a test needs in the test itself
// or in a `beforeEach`; stubs made at module scope or in `beforeAll` are replaced.
installMockWindowApi();
beforeEach(installMockWindowApi);
// Explore remembers its list position in sessionStorage; each test starts without it.
beforeEach(() => window.sessionStorage.clear());
