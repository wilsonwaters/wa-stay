/**
 * NotificationDispatcher delivery logging against a real migrated database, and the skip of
 * notifiers whose stored settings cannot be decrypted.
 *
 * Before v7, every delivery-log insert failed (no such table: main.notifications_old), and
 * the second logDelivery in the dispatcher's catch block threw out of dispatch(), so one
 * failing notifier stopped every notifier after it.
 */

import Database from 'better-sqlite3';
import { TestDatabaseHelper } from '@tests/utils/database-helper';
import { NotifierRepository } from '@main/database/repositories';
import { NotificationDispatcher } from '@main/core/notifications/notification-dispatcher';
import { BaseNotifier } from '@main/core/notifications/notifiers/base.notifier';
import { logger } from '@main/utils/logger';
import {
  NotifierChannel,
  NotificationDeliveryResult,
  NotificationMessage,
  NotifierValidationResult,
  TestConnectionResult,
} from '@shared/types';
import { FakeSafeStorage, FOREIGN_OS_KEY, testVault } from '@tests/utils/fake-safe-storage';

/** In-memory notifier: records what it receives, or throws when told to. */
/** A second channel for the multi-notifier cases: email is the only real one today. */
const SECOND_CHANNEL = 'second' as NotifierChannel;

class FakeNotifier extends BaseNotifier {
  readonly received: NotificationMessage[] = [];

  constructor(
    channel: NotifierChannel,
    private readonly behaviour: 'deliver' | 'throw'
  ) {
    super(channel, `Fake ${channel}`);
    this.setEnabled(true);
  }

  async send(message: NotificationMessage): Promise<NotificationDeliveryResult> {
    if (this.behaviour === 'throw') throw new Error('SMTP connection reset');
    this.received.push(message);
    return { success: true, messageId: `<${this.channel}-1@example.com>` };
  }

  async testConnection(): Promise<TestConnectionResult> {
    return { success: true, message: 'ok' };
  }

  validate(): NotifierValidationResult {
    return { valid: true, errors: [] };
  }
}

interface LogRow {
  notifier_channel: string;
  status: string;
  message_id: string | null;
  error_message: string | null;
}

describe('NotificationDispatcher delivery logging', () => {
  let dbHelper: TestDatabaseHelper;
  let db: Database.Database;
  let notifierRepo: NotifierRepository;
  let dispatcher: NotificationDispatcher;

  const message: NotificationMessage = { title: 'Availability found', message: 'Site 136 is free' };

  /** Puts fakes in the dispatcher's notifier map, in dispatch order. */
  function useNotifiers(...notifiers: FakeNotifier[]): void {
    const registry = dispatcher.getAllNotifiers();
    registry.clear();
    for (const notifier of notifiers) registry.set(notifier.getChannel(), notifier);
  }

  function logs(): LogRow[] {
    return db
      .prepare(
        'SELECT notifier_channel, status, message_id, error_message FROM notification_delivery_logs ORDER BY id'
      )
      .all() as LogRow[];
  }

  beforeEach(async () => {
    dbHelper = new TestDatabaseHelper('notification-dispatch');
    db = await dbHelper.setup();
    notifierRepo = new NotifierRepository(db, testVault().vault);
    dispatcher = new NotificationDispatcher(notifierRepo, []);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await dbHelper.teardown();
  });

  it('writes a delivery-log row for a successful send', async () => {
    const email = new FakeNotifier(NotifierChannel.EMAIL_SMTP, 'deliver');
    useNotifiers(email);

    const results = await dispatcher.dispatch(message);

    expect(email.received).toEqual([message]);
    expect(results).toEqual([
      {
        channel: NotifierChannel.EMAIL_SMTP,
        result: { success: true, messageId: '<email_smtp-1@example.com>' },
      },
    ]);
    expect(logs()).toEqual([
      {
        notifier_channel: 'email_smtp',
        status: 'sent',
        message_id: '<email_smtp-1@example.com>',
        error_message: null,
      },
    ]);
  });

  it('keeps dispatching to the next notifier after one throws, and logs both', async () => {
    const failing = new FakeNotifier(NotifierChannel.EMAIL_SMTP, 'throw');
    const next = new FakeNotifier(SECOND_CHANNEL, 'deliver');
    useNotifiers(failing, next);

    const results = await dispatcher.dispatch(message);

    expect(next.received).toEqual([message]);
    expect(results.map((r) => [r.channel, r.result.success])).toEqual([
      [NotifierChannel.EMAIL_SMTP, false],
      [SECOND_CHANNEL, true],
    ]);
    expect(logs()).toEqual([
      {
        notifier_channel: 'email_smtp',
        status: 'failed',
        message_id: null,
        error_message: 'SMTP connection reset',
      },
      {
        notifier_channel: 'second',
        status: 'sent',
        message_id: '<second-1@example.com>',
        error_message: null,
      },
    ]);
  });

  it('keeps dispatching, and reports sends truthfully, when writing the delivery log fails', async () => {
    // The pre-v7 failure mode: every delivery-log insert threw.
    const logDelivery = jest.spyOn(notifierRepo, 'logDelivery').mockImplementation(() => {
      throw new Error('no such table: main.notifications_old');
    });
    const error = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const failing = new FakeNotifier(NotifierChannel.EMAIL_SMTP, 'throw');
    const next = new FakeNotifier(SECOND_CHANNEL, 'deliver');
    useNotifiers(failing, next);

    const results = await dispatcher.dispatch(message);

    expect(next.received).toEqual([message]);
    expect(results).toEqual([
      {
        channel: NotifierChannel.EMAIL_SMTP,
        result: { success: false, error: 'SMTP connection reset' },
      },
      {
        channel: SECOND_CHANNEL,
        result: { success: true, messageId: '<second-1@example.com>' },
      },
    ]);
    expect(logDelivery).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      'Failed to write delivery log for second:',
      expect.objectContaining({ message: 'no such table: main.notifications_old' })
    );
  });

  it('skips a notifier whose stored settings cannot be decrypted (logging it once) and sends again once saved', async () => {
    // Settings saved under another machine's OS key: unreadable here
    const other = testVault({ safeStorage: new FakeSafeStorage(FOREIGN_OS_KEY) });
    new NotifierRepository(db, other.vault).upsert({
      channel: NotifierChannel.EMAIL_SMTP,
      displayName: 'Email (SMTP)',
      enabled: true,
      config: { host: 'smtp.example.com', auth: { user: 'me', pass: 'unreadable-pass' } },
    });
    const email = new FakeNotifier(NotifierChannel.EMAIL_SMTP, 'deliver');
    const send = jest.spyOn(email, 'send');
    const configure = jest.spyOn(email, 'configure');
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    const loaded = new NotificationDispatcher(notifierRepo, [email]);

    const first = await loaded.dispatch(message);
    await loaded.dispatch(message);

    expect(send).not.toHaveBeenCalled();
    expect(configure).not.toHaveBeenCalled(); // never configured with an empty config
    expect(first).toEqual([
      {
        channel: NotifierChannel.EMAIL_SMTP,
        result: { success: false, error: 'Saved password could not be decrypted; re-enter it' },
      },
    ]);
    expect(warn.mock.calls.filter(([text]) => /Skipping notifier email_smtp/.test(text))).toEqual([
      [
        'Skipping notifier email_smtp: its saved settings could not be decrypted; re-enter them in Settings',
      ],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('unreadable-pass');
    expect(logs()).toEqual([]);
    await expect(loaded.testNotifier(NotifierChannel.EMAIL_SMTP)).resolves.toMatchObject({
      success: false,
    });

    // The user saves the settings again
    loaded.configureNotifier(NotifierChannel.EMAIL_SMTP, { host: 'smtp.example.com' }, true);
    await loaded.dispatch(message);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
