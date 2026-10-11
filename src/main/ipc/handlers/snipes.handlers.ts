/**
 * `snipes` handlers. Snipes belong to the local profile; the renderer never sends a user id.
 * Every change re-arms the snipe's timer chain (a new generation), and a deactivated or
 * deleted snipe has its chain stopped and its attempt in flight aborted. `openPayment` opens
 * the payment window for a HELD snipe's hold (`HoldPaymentService`).
 */

import { contract } from '@shared/contracts';
import type { AppContainer } from '../../app/container';
import { AppError } from '../../utils/app-error';
import type { Handle } from '../handle';

export function registerSnipesHandlers(handle: Handle, c: AppContainer): void {
  const { snipes } = contract;

  handle(snipes.list, (filter) =>
    c.siteSniperService.list(c.profile.requireUserId(), filter ?? {})
  );

  handle(snipes.get, ({ id }) => c.siteSniperService.get(id));

  handle(snipes.create, async (input) => {
    const snipe = await c.siteSniperService.create(c.profile.requireUserId(), input);
    c.scheduler.scheduleSnipe(snipe.id);
    return snipe;
  });

  handle(snipes.update, async ({ id, updates }) => {
    const snipe = await c.siteSniperService.update(id, updates);
    c.scheduler.rescheduleSnipe(id);
    return snipe;
  });

  handle(snipes.delete, async ({ id }) => {
    c.scheduler.unscheduleSnipe(id);
    if (!(await c.siteSniperService.delete(id))) throw new AppError('NOT_FOUND', 'Snipe not found');
    return true;
  });

  handle(snipes.activate, async ({ id }) => {
    await c.siteSniperService.activate(id);
    c.scheduler.rescheduleSnipe(id);
  });

  handle(snipes.deactivate, async ({ id }) => {
    c.scheduler.unscheduleSnipe(id);
    await c.siteSniperService.deactivate(id);
  });

  handle(snipes.runNow, ({ id }) => c.scheduler.runSnipeNow(id));

  handle(snipes.openPayment, ({ id }) => c.holdPayments.openForSnipe(id));
}
