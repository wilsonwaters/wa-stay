/**
 * `bookings`: the local booking records. The renderer never sends a user id; main acts for
 * the local profile.
 */

import { z } from 'zod';
import type {
  Booking,
  BookingImportRequest,
  BookingInput,
  BookingListFilter,
  BookingUpdate,
} from '../types/booking.types';
import { BookingStatus } from '../types/common.types';
import { ProviderIdSchema, StayParamsSchema } from '../types/provider.types';
import { BookingLocationRefSchema, StayInputSchema } from '../types/stay.types';
import { assertTypeEquals } from '../utils/type-equality';
import { CHANNELS } from './channels';
import { id, idPayload, Namespace } from './define';

const C = CHANNELS.bookings;

/**
 * A booking as the renderer sends it. Field types only (plus the stay's own date order):
 * the other cross-field rules (guest limits) stay in `BookingService`. Stay dates are
 * calendar dates `YYYY-MM-DD`.
 */
export const bookingInputSchema = z.object({
  providerId: ProviderIdSchema,
  bookingReference: z.string().min(1),
  location: BookingLocationRefSchema,
  stay: StayInputSchema,
  unitIds: z.array(z.string()).optional(),
  stayParams: StayParamsSchema.optional(),
  totalCost: z.number().optional(),
  notes: z.string().optional(),
});
assertTypeEquals<z.input<typeof bookingInputSchema>, BookingInput>(true);
assertTypeEquals<z.output<typeof bookingInputSchema>, BookingInput>(true);

/** An update: any field but the provider. */
export const bookingUpdateSchema = bookingInputSchema.omit({ providerId: true }).partial();
assertTypeEquals<z.input<typeof bookingUpdateSchema>, BookingUpdate>(true);
assertTypeEquals<z.output<typeof bookingUpdateSchema>, BookingUpdate>(true);

const bookingStatusSchema: z.ZodType<BookingStatus, BookingStatus> = z.enum(BookingStatus);

/** `bookings.list`: every booking of the local profile, or those of one provider or status. */
export const bookingListFilterSchema = z.object({
  providerId: ProviderIdSchema.optional(),
  status: bookingStatusSchema.optional(),
});
assertTypeEquals<z.input<typeof bookingListFilterSchema>, BookingListFilter>(true);
assertTypeEquals<z.output<typeof bookingListFilterSchema>, BookingListFilter>(true);

/** `bookings.import`: fetch a booking from its provider (`capabilities.bookingImport`). */
export const bookingImportSchema = z.object({
  providerId: ProviderIdSchema,
  reference: z.string().trim().min(1),
});
assertTypeEquals<z.input<typeof bookingImportSchema>, BookingImportRequest>(true);
assertTypeEquals<z.output<typeof bookingImportSchema>, BookingImportRequest>(true);

export const bookings = {
  list: {
    channel: C.list,
    // No payload lists everything.
    request: bookingListFilterSchema.optional(),
    args: {} as [filter?: BookingListFilter],
    response: {} as Booking[],
  },
  get: {
    channel: C.get,
    request: idPayload,
    args: {} as [id: number],
    response: {} as Booking | null,
  },
  create: {
    channel: C.create,
    request: bookingInputSchema,
    args: {} as [input: BookingInput],
    response: {} as Booking,
  },
  update: {
    channel: C.update,
    request: z.object({ id, updates: bookingUpdateSchema }),
    args: {} as [id: number, updates: BookingUpdate],
    response: {} as Booking,
  },
  delete: {
    channel: C.delete,
    request: idPayload,
    args: {} as [id: number],
    response: {} as boolean,
  },
  import: {
    channel: C.import,
    request: bookingImportSchema,
    args: {} as [providerId: string, reference: string],
    response: {} as Booking,
  },
} satisfies Namespace;
