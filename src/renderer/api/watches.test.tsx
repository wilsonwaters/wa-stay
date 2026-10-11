import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMockApi, ok } from '@tests/utils/renderer/createMockApi';
import { makeWatch } from '@tests/fixtures/renderer/watches';
import { createQueryClient } from '../app/queryClient';
import { queryKeys } from './queryKeys';
import { useDeleteWatch, useRunWatchNow, useWatch, useWatchUpdates } from './watches';

function setup(stubs = {}) {
  const mock = createMockApi(stubs);
  window.api = mock.api;
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { mock, client, wrapper };
}

describe('watch hooks', () => {
  it('Check now refetches the watch once: from the watch:updated main sends after the check', async () => {
    const watch = makeWatch({ id: 4 });
    const get = jest.fn().mockResolvedValue(ok(watch));
    const runNow = jest
      .fn()
      .mockResolvedValue(
        ok({ watchId: 4, success: true, found: false, matches: [], checkedAt: new Date() })
      );
    const { mock, wrapper } = setup({
      watches: { get, runNow, list: jest.fn().mockResolvedValue(ok([])) },
    });
    const { result } = renderHook(
      () => {
        useWatchUpdates();
        return { watch: useWatch(4), run: useRunWatchNow() };
      },
      { wrapper }
    );
    await waitFor(() => expect(result.current.watch.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.run.mutateAsync(4);
    });
    expect(get).toHaveBeenCalledTimes(1);
    mock.emit('watch:updated', watch);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 700));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('a delete drops the watch’s own cache entry', async () => {
    const { client, wrapper } = setup({
      watches: {
        delete: jest.fn().mockResolvedValue(ok(true)),
        list: jest.fn().mockResolvedValue(ok([])),
      },
    });
    client.setQueryData(queryKeys.watches.detail(4), makeWatch({ id: 4 }));
    const { result } = renderHook(() => useDeleteWatch(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(4);
    });
    expect(client.getQueryData(queryKeys.watches.detail(4))).toBeUndefined();
  });
});
