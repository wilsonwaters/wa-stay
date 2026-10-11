import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Booking, BookingInput } from '../../shared/types/booking.types';
import { unwrap } from './client';
import { useInvalidateOn } from './events';
import { queryKeys } from './queryKeys';

/**
 * Every booking of the local profile, in one cache entry. The Bookings page buckets, filters
 * and searches it in the renderer, so changing a tab or filter never refetches.
 */
export function useBookings() {
  return useQuery({
    queryKey: queryKeys.bookings.list(),
    queryFn: () => unwrap((api) => api.bookings.list()),
  });
}

/** One booking, or `null` when it does not exist (it was removed). */
export function useBooking(id: number) {
  return useQuery({
    queryKey: queryKeys.bookings.detail(id),
    queryFn: () => unwrap((api) => api.bookings.get(id)),
    enabled: Number.isInteger(id) && id > 0,
  });
}

/**
 * Keeps every booking query fresh: main sends `booking:updated` after each change, including
 * a booking a paid hold recorded (V6) and one removed elsewhere.
 */
export function useBookingUpdates(): void {
  useInvalidateOn('booking:updated', queryKeys.bookings.all);
}

/** Records a booking made outside WA Stay (`bookings.create`). Main resolves the profile. */
export function useCreateBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BookingInput) => unwrap((api) => api.bookings.create(input)),
    onSuccess: (booking: Booking) => {
      queryClient.setQueryData(queryKeys.bookings.detail(booking.id), booking);
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.list() });
    },
  });
}

/**
 * Removes a booking from WA Stay only (`bookings.delete`); nothing changes at the provider.
 * The list drops it at once, then refetches.
 */
export function useDeleteBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrap((api) => api.bookings.delete(id)),
    onSuccess: (_deleted, id) => {
      queryClient.setQueryData<Booking[]>(queryKeys.bookings.list(), (list) =>
        list?.filter((booking) => booking.id !== id)
      );
      queryClient.removeQueries({ queryKey: queryKeys.bookings.detail(id), exact: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.list() });
    },
  });
}

/**
 * Fetches a booking from its provider by reference (`bookings.import`), for providers with
 * `capabilities.bookingImport`. Others answer `CAPABILITY`.
 */
export function useImportBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, reference }: { providerId: string; reference: string }) =>
      unwrap((api) => api.bookings.import(providerId, reference)),
    onSuccess: (booking: Booking) => {
      queryClient.setQueryData(queryKeys.bookings.detail(booking.id), booking);
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.list() });
    },
  });
}
