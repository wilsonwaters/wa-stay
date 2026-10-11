import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMockApi, fail, ok, PARKSTAY_MANIFEST } from '@tests/utils/renderer/createMockApi';
import { createQueryClient } from '../app/queryClient';
import { ApiError } from './client';
import { useProvider, useProviders, useProvidersWith } from './providers';

const OTHER = {
  ...PARKSTAY_MANIFEST,
  id: 'other',
  name: 'Other Stays',
  shortName: 'Other',
  capabilities: { ...PARKSTAY_MANIFEST.capabilities, snipes: false, holds: false },
};

function wrapper() {
  const client = createQueryClient();
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('provider hooks', () => {
  it('useProviders returns the manifests from providers.list()', async () => {
    const list = jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST, OTHER]));
    window.api = createMockApi({ providers: { list } }).api;
    const { result } = renderHook(() => useProviders(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([PARKSTAY_MANIFEST, OTHER]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('useProvider picks one manifest by id, and useProvidersWith filters by capability', async () => {
    window.api = createMockApi({
      providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST, OTHER])) },
    }).api;
    const { result } = renderHook(
      () => ({
        one: useProvider('other'),
        missing: useProvider('nope'),
        snipes: useProvidersWith('snipes'),
        watches: useProvidersWith('watches'),
      }),
      { wrapper: wrapper() }
    );
    await waitFor(() => expect(result.current.snipes.isSuccess).toBe(true));
    expect(result.current.one.data?.shortName).toBe('Other');
    expect(result.current.missing.data).toBeUndefined();
    expect(result.current.snipes.data?.map((m) => m.id)).toEqual(['parkstay']);
    expect(result.current.watches.data?.map((m) => m.id)).toEqual(['parkstay', 'other']);
  });

  it('surfaces a rejected response as an ApiError with its message', async () => {
    window.api = createMockApi({
      providers: {
        list: jest.fn().mockResolvedValue(fail('The provider registry is not ready', 'NOT_FOUND')),
      },
    }).api;
    const { result } = renderHook(() => useProviders(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error?.message).toBe('The provider registry is not ready');
  });
});
