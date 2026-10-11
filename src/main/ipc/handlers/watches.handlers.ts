/**
 * `watches` handlers. Watches belong to the local profile; the renderer never sends a user id.
 * A new or re-activated watch is due at once, and the scheduler's due-loop picks it up; a
 * deactivated or deleted one has its check in flight stopped. `openPayment` opens the payment
 * window for a watch's automatic hold (`HoldPaymentService`).
 */

import { contract } from '@shared/contracts';
import type { AppContainer } from '../../app/container';
import { AppError } from '../../utils/app-error';
import type { Handle } from '../handle';

export function registerWatchesHandlers(handle: Handle, c: AppContainer): void {
  const { watches } = contract;

  handle(watches.list, (filter) => c.watchService.list(c.profile.requireUserId(), filter ?? {}));

  handle(watches.get, ({ id }) => c.watchService.get(id));

  handle(watches.create, (input) => c.watchService.create(c.profile.requireUserId(), input));

  handle(watches.update, ({ id, updates }) => c.watchService.update(id, updates));

  handle(watches.delete, async ({ id }) => {
    c.scheduler.cancelWatch(id);
    if (!(await c.watchService.delete(id))) throw new AppError('NOT_FOUND', 'Watch not found');
    return true;
  });

  handle(watches.activate, ({ id }) => c.watchService.activate(id));

  handle(watches.deactivate, async ({ id }) => {
    await c.watchService.deactivate(id);
    c.scheduler.cancelWatch(id);
  });

  handle(watches.runNow, ({ id }) => c.scheduler.runWatchNow(id));

  handle(watches.openPayment, ({ id }) => c.holdPayments.openForWatch(id));
}
