/**
 * `notifiers` handlers: outbound notification channels (email SMTP). The SMTP password is
 * write-only: every response is a `NotifierView` without it, and `configure` without a
 * password keeps the stored one (in the database and in the dispatcher), but only for an
 * unchanged host, port and user (`withStoredPassword`). `test` takes no settings: it
 * connects with what `configure` stored, so it follows the same rule and cannot send the
 * stored password to another server.
 */

import { contract } from '@shared/contracts';
import type { AppContainer } from '../../app/container';
import { toNotifierView, withStoredPassword } from '../../core/notifications/notifier-view';
import { logger } from '../../utils/logger';
import type { Handle } from '../handle';

export function registerNotifiersHandlers(handle: Handle, c: AppContainer): void {
  const { notifiers } = contract;
  const repository = c.repositories.notifiers;
  const dispatcher = c.notifierDispatcher;

  handle(notifiers.list, () => repository.findAll().map(toNotifierView));

  handle(notifiers.get, ({ channel }) => {
    const notifier = repository.findByChannel(channel);
    return notifier ? toNotifierView(notifier) : null;
  });

  handle(notifiers.configure, (input) => {
    const stored = repository.findByChannel(input.channel);
    // Throws VALIDATION when there is no password to use for this server and account
    const config = withStoredPassword(input.config, stored?.config);

    const notifier = repository.upsert({ ...input, config });
    dispatcher.configureNotifier(
      input.channel,
      config as unknown as Record<string, unknown>,
      input.enabled || false
    );
    logger.info(`Notifier ${input.channel} configured`);
    return toNotifierView(notifier);
  });

  handle(notifiers.enable, ({ channel }) => {
    const changed = repository.enable(channel);
    if (changed) dispatcher.loadNotifierConfigurations();
    return changed;
  });

  handle(notifiers.disable, ({ channel }) => {
    const changed = repository.disable(channel);
    if (changed) dispatcher.loadNotifierConfigurations();
    return changed;
  });

  handle(notifiers.test, async ({ channel }) => {
    const result = await dispatcher.testNotifier(channel);
    // Unreadable settings were not tested: their error state is computed, never stored
    if (!dispatcher.isUnreadable(channel)) {
      repository.updateLastTested(channel, result.success, result.error);
    }
    return result;
  });
}
