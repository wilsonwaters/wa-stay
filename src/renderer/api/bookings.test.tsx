import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMockApi, ok } from '@tests/utils/renderer/createMockApi';
import { makeBooking } from '@tests/fixtures/renderer/bookings';
import { createQueryClient } from '../app/queryClient';
import { queryKeys } from './queryKeys';
import { useBookings, useBookingUpdates, useDeleteBooking, useImportBooking } from './bookings';

function setup(stubs = {}) {
  const mock = createMockApi(stubs);
  window.api = mock.api;
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { mock, client, wrapper };
}

describe('booking hooks', () => {
  it('refetches the list when main sends booking:updated (a paid hold recorded one)', async () => {
    const list = jest
      .fn()
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValue(ok([makeBooking({ id: 5 })]));
    const { mock, wrapper } = setup({ bookings: { list } });
    const { result } = renderHook(
      () => {
        useBookingUpdates();
        return useBookings();
      },
      { wrapper }
    );
    await waitFor(() => expect(result.current.data).toEqual([]));
    mock.emit('booking:updated', makeBooking({ id: 5 }));
    await waitFor(() => expect(result.current.data?.map((b) => b.id)).toEqual([5]));
  });

  it('a delete drops the booking from the list at once, and its own cache entry', async () => {
    const { client, wrapper } = setup({
      bookings: {
        delete: jest.fn().mockResolvedValue(ok(true)),
        list: jest.fn(() => new Promise(() => undefined)),
      },
    });
    client.setQueryData(queryKeys.bookings.list(), [
      makeBooking({ id: 4 }),
      makeBooking({ id: 5 }),
    ]);
    client.setQueryData(queryKeys.bookings.detail(4), makeBooking({ id: 4 }));
    const { result } = renderHook(() => useDeleteBooking(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(4);
    });
    expect(client.getQueryData(queryKeys.bookings.detail(4))).toBeUndefined();
    expect(
      client.getQueryData<{ id: number }[]>(queryKeys.bookings.list())?.map((b) => b.id)
    ).toEqual([5]);
  });

  it('imports by provider and reference', async () => {
    const imported = makeBooking({ id: 9, providerId: 'tripco' });
    const importBooking = jest.fn().mockResolvedValue(ok(imported));
    const { client, wrapper } = setup({ bookings: { import: importBooking } });
    const { result } = renderHook(() => useImportBooking(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ providerId: 'tripco', reference: 'tc-1' });
    });
    expect(importBooking).toHaveBeenCalledWith('tripco', 'tc-1');
    expect(client.getQueryData(queryKeys.bookings.detail(9))).toEqual(imported);
  });
});
