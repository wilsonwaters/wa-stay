/**
 * `watches`: availability watches of the local profile.
 */

import { z } from 'zod';
import { DEFAULT_WATCH_INTERVAL, WATCH_INTERVAL_OPTIONS } from '../constants/app-constants';
import { ProviderIdSchema, StayParamsSchema } from '../types/provider.types';
import { LocationRefSchema, StayInputSchema } from '../types/stay.types';
import type {
  Watch,
  WatchExecutionResult,
  WatchInput,
  WatchListFilter,
  WatchUpdate,
} from '../types/watch.types';
import { assertTypeEquals } from '../utils/type-equality';
import { CHANNELS } from './channels';
import { id, idPayload, Namespace } from './define';

const C = CHANNELS.watches;

/** The check intervals a watch may have (minutes), and the default (PQ6). */
export { DEFAULT_WATCH_INTERVAL, WATCH_INTERVAL_OPTIONS };

const checkIntervalSchema = z
  .number()
  .int()
  .refine((minutes) => (WATCH_INTERVAL_OPTIONS as readonly number[]).includes(minutes), {
    error: `Must be one of ${WATCH_INTERVAL_OPTIONS.join(', ')} minutes`,
  });

/**
 * A watch as the renderer sends it. Field types only (plus the stay's own date order), so
 * it can be `.partial()`'d for updates; the cross-field rules (dates in the future) stay in
 * `WatchService`. Stay dates are calendar dates `YYYY-MM-DD`.
 */
export const watchInputSchema = z.object({
  providerId: ProviderIdSchema,
  name: z.string().min(1),
  location: LocationRefSchema,
  stay: StayInputSchema,
  unitIds: z.array(z.string()).optional(),
  stayParams: StayParamsSchema.optional(),
  checkIntervalMinutes: checkIntervalSchema.optional(),
  autoHold: z.boolean().optional(),
  notifyOnly: z.boolean().optional(),
  allowPartialMatch: z.boolean().optional(),
  maxPrice: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});
assertTypeEquals<z.input<typeof watchInputSchema>, WatchInput>(true);
assertTypeEquals<z.output<typeof watchInputSchema>, WatchInput>(true);

/** An update: any field but the provider. */
export const watchUpdateSchema = watchInputSchema.omit({ providerId: true }).partial();
assertTypeEquals<z.input<typeof watchUpdateSchema>, WatchUpdate>(true);
assertTypeEquals<z.output<typeof watchUpdateSchema>, WatchUpdate>(true);

/** `watches.list`: every watch of the local profile, or those of one provider or state. */
export const watchListFilterSchema = z.object({
  providerId: ProviderIdSchema.optional(),
  status: z.enum(['active', 'inactive']).optional(),
});
assertTypeEquals<z.input<typeof watchListFilterSchema>, WatchListFilter>(true);
assertTypeEquals<z.output<typeof watchListFilterSchema>, WatchListFilter>(true);

export const watches = {
  list: {
    channel: C.list,
    // No payload lists everything.
    request: watchListFilterSchema.optional(),
    args: {} as [filter?: WatchListFilter],
    response: {} as Watch[],
  },
  get: {
    channel: C.get,
    request: idPayload,
    args: {} as [id: number],
    response: {} as Watch | null,
  },
  create: {
    channel: C.create,
    request: watchInputSchema,
    args: {} as [input: WatchInput],
    response: {} as Watch,
  },
  update: {
    channel: C.update,
    request: z.object({ id, updates: watchUpdateSchema }),
    args: {} as [id: number, updates: WatchUpdate],
    response: {} as Watch,
  },
  delete: {
    channel: C.delete,
    request: idPayload,
    args: {} as [id: number],
    response: {} as boolean,
  },
  activate: {
    channel: C.activate,
    request: idPayload,
    args: {} as [id: number],
    response: undefined as void,
  },
  deactivate: {
    channel: C.deactivate,
    request: idPayload,
    args: {} as [id: number],
    response: undefined as void,
  },
  runNow: {
    channel: C.runNow,
    request: idPayload,
    args: {} as [id: number],
    response: {} as WatchExecutionResult,
  },
  /**
   * Opens the provider's payment page for the watch's automatic hold, in a payment window on
   * the provider's session. Resolves once it is open. `HOLD_EXPIRED` when there is no hold
   * left to pay for; `VALIDATION` while another hold's payment window is open.
   */
  openPayment: {
    channel: C.openPayment,
    request: idPayload,
    args: {} as [id: number],
    response: undefined as void,
  },
} satisfies Namespace;
