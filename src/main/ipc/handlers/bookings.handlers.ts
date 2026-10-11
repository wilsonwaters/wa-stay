/**
 * `bookings` handlers. Bookings belong to the local profile; the renderer never sends a user id.
 */

import { contract } from '@shared/contracts';
import type { AppContainer } from '../../app/container';
import type { Handle } from '../handle';

export function registerBookingsHandlers(handle: Handle, c: AppContainer): void {
  const { bookings } = contract;

  handle(bookings.list, (filter) =>
    c.bookingService.listBookings(c.profile.requireUserId(), filter ?? {})
  );

  handle(bookings.get, ({ id }) => c.bookingService.getBooking(id));

  handle(bookings.create, (input) =>
    c.bookingService.createBooking(c.profile.requireUserId(), input)
  );

  handle(bookings.update, ({ id, updates }) => c.bookingService.updateBooking(id, updates));

  handle(bookings.delete, async ({ id }) => {
    await c.bookingService.deleteBooking(id);
    return true;
  });

  handle(bookings.import, ({ providerId, reference }) =>
    c.bookingService.importBooking(c.profile.requireUserId(), providerId, reference)
  );
}
