/**
 * NotificationRepository type validation. Since v7 the notifications table has no CHECK
 * constraints, so the repository is what keeps unknown types out.
 */

import Database from 'better-sqlite3';
import { insertUser, TestDatabaseHelper } from '@tests/utils/database-helper';
import { NotificationRepository } from '@main/database/repositories';
import { NotificationType, RelatedType } from '@shared/types/common.types';
import { mockUserInput } from '@tests/fixtures/users';

describe('NotificationRepository validation', () => {
  let dbHelper: TestDatabaseHelper;
  let db: Database.Database;
  let repo: NotificationRepository;
  let userId: number;

  beforeEach(async () => {
    dbHelper = new TestDatabaseHelper('notification-repo');
    db = await dbHelper.setup();
    userId = insertUser(db, mockUserInput.email).id;
    repo = new NotificationRepository(db);
  });

  afterEach(async () => {
    await dbHelper.teardown();
  });

  it('create rejects a type or related type outside the enums and stores nothing', () => {
    const base = { userId, title: 't', message: 'm' };

    expect(() => repo.create({ ...base, type: 'bogus' as NotificationType })).toThrow(
      'Unknown notification type: bogus'
    );
    expect(() => repo.create({ ...base, type: 'stq_success' as NotificationType })).toThrow(
      'Unknown notification type: stq_success'
    );
    expect(() =>
      repo.create({ ...base, type: NotificationType.INFO, relatedType: 'stq' as RelatedType })
    ).toThrow('Unknown notification related type: stq');
    expect(repo.findByUserId(userId)).toEqual([]);

    const ok = repo.create({
      ...base,
      type: NotificationType.SNIPE_HELD,
      relatedType: RelatedType.SNIPE,
      relatedId: 7,
    });
    expect(ok).toMatchObject({ type: 'snipe_held', relatedType: 'snipe', relatedId: 7 });
  });

  it('still reads legacy stq_success / stq rows', () => {
    db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, message, related_id, related_type)
       VALUES (40, ?, 'stq_success', 'Rebooked', 'Skip The Queue rebooked', 1, 'stq')`
    ).run(userId);

    expect(repo.findById(40)).toMatchObject({
      id: 40,
      type: 'stq_success',
      relatedType: 'stq',
      title: 'Rebooked',
    });
    expect(repo.findByUserId(userId).map((n) => n.id)).toEqual([40]);
  });
});
