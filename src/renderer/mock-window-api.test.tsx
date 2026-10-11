/**
 * The renderer test environment's `window.api` mock: createMockWindowApi() from
 * tests/utils/window-api.ts, installed by tests/setup/renderer.ts before every test.
 */

import { createMockWindowApi } from '@tests/utils/window-api';

// Members the real API does not have, as P3's reshaped API might. The Proxy needs no list.
type LooseApi = Record<string, Record<string, jest.Mock>>;
type NestedApi = { providers: { parkstay: { accounts: { signIn: jest.Mock } } } };

describe('createMockWindowApi', () => {
  it('rejects a call to an un-stubbed method with an error naming it', async () => {
    const api = window.api as unknown as LooseApi;

    await expect(api.x.y()).rejects.toThrow('window.api.x.y is not mocked in this test');
    await expect(window.api.watches.list()).rejects.toThrow(
      'window.api.watches.list is not mocked in this test'
    );
    expect(api.x.y).toHaveBeenCalledTimes(1);
  });

  it('returns what a test stubs, whether through jest.mocked or by assignment', async () => {
    const watches = { success: true, data: [] };
    jest.mocked(window.api.watches.list).mockResolvedValue(watches);
    window.api.settings.get = jest.fn().mockResolvedValue({ success: true, data: true });

    await expect(window.api.watches.list()).resolves.toBe(watches);
    await expect(window.api.settings.get('launchOnStartup')).resolves.toEqual({
      success: true,
      data: true,
    });
    // The same member is returned on every access, so the code under test calls the stub.
    expect(window.api.watches.list).toBe(window.api.watches.list);
    expect(window.api.watches.list).toHaveBeenCalledWith();
    // Stubbing one method leaves its siblings un-stubbed.
    await expect(window.api.watches.get(1)).rejects.toThrow('window.api.watches.get');
  });

  it('supports nested namespaces at any depth', async () => {
    const api = createMockWindowApi() as unknown as NestedApi;
    const signIn = api.providers.parkstay.accounts.signIn;

    await expect(signIn('parkstay')).rejects.toThrow(
      'window.api.providers.parkstay.accounts.signIn is not mocked in this test'
    );

    signIn.mockResolvedValue({ success: true });
    await expect(api.providers.parkstay.accounts.signIn('parkstay')).resolves.toEqual({
      success: true,
    });
    expect(api.providers.parkstay).toBe(api.providers.parkstay);
    // Namespaces are not thenables, so awaiting or returning one from an async function
    // resolves to the namespace instead of hanging.
    await expect(Promise.resolve(api.providers)).resolves.toBe(api.providers);
  });

  describe('installed by the renderer setup', () => {
    let previous: Window['api'];

    it('is stubbed by one test', () => {
      previous = window.api;
      jest.mocked(window.api.watches.list).mockResolvedValue({ success: true, data: [] });
    });

    it('is fresh in the next test, with nothing stubbed', async () => {
      expect(window.api).not.toBe(previous);
      await expect(window.api.watches.list()).rejects.toThrow(
        'window.api.watches.list is not mocked in this test'
      );
    });
  });
});
