/**
 * `playwright-core` is loaded lazily (V7): building the app's container, and so every
 * provider's context, never imports it; the first `withPage` does, once. When it cannot be
 * loaded, browser automation reports `runtime-missing`.
 */

const mockPlaywright = { imports: 0, missing: false };

jest.mock('playwright-core', () => {
  mockPlaywright.imports++;
  if (mockPlaywright.missing) throw new Error("Cannot find module 'playwright-core'");
  return jest.requireActual('@tests/utils/fake-playwright').fakePlaywrightModule();
});
jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

import { createContainer } from '@main/app/container';
import { openDatabase } from '@main/database/connection';
import { createPlaywrightTestProviderContext } from '@tests/utils/fake-provider';
import { TEST_LOGS_DIR } from '@tests/utils/ipc-harness';
import { containerSecrets, FakeSafeStorage, removeUserData } from '@tests/utils/fake-safe-storage';

describe('loading playwright-core', () => {
  it('is not imported when the app builds its providers, nor when they close', async () => {
    const secrets = containerSecrets(new FakeSafeStorage());
    const container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...secrets,
    });
    expect(container.providers.list().map((m) => m.id)).toContain('parkstay');
    const ctx = createPlaywrightTestProviderContext('fake');
    await ctx.browser.close();
    await container.dispose();
    removeUserData(secrets.userDataDir);

    expect(mockPlaywright.imports).toBe(0);
  });

  it('is imported by the first withPage, once', async () => {
    const ctx = createPlaywrightTestProviderContext('fake');
    await ctx.browser.withPage(async () => undefined);
    await ctx.browser.withPage(async () => undefined);
    await ctx.browser.close();

    expect(mockPlaywright.imports).toBe(1);
  });

  it('reports runtime-missing when it cannot be loaded', async () => {
    jest.resetModules();
    mockPlaywright.missing = true;
    // A fresh module registry, so the mocked module is required (and fails) again.
    const { createPlaywrightTestProviderContext: freshContext } = jest.requireActual(
      '@tests/utils/fake-provider'
    ) as typeof import('@tests/utils/fake-provider');
    const ctx = freshContext('fake', {});

    await expect(ctx.browser.withPage(async () => undefined)).rejects.toMatchObject({
      name: 'BrowserUnavailableError',
      reason: 'runtime-missing',
    });
    expect(await ctx.browser.isAvailable()).toEqual({
      available: false,
      reason: 'runtime-missing',
    });
    expect(await freshContext('fake2').browser.isAvailable()).toEqual({
      available: false,
      reason: 'runtime-missing',
    });
    expect(mockPlaywright.imports).toBe(3);
  });
});
