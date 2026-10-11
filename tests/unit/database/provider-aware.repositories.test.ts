/**
 * The provider-aware repositories (V2) against a real v8 database: watches and bookings
 * round-trip calendar dates, stay params and unit ids; the defensive JSON reads; the
 * `provider_state` key-value store; and the provider accounts.
 */

import Database from 'better-sqlite3';
import { TestDatabaseHelper } from '@tests/utils/database-helper';
import {
  BookingRepository,
  NotificationRepository,
  ProviderAccountRepository,
  ProviderStateRepository,
  SqliteKeyValueStore,
  WatchRepository,
} from '@main/database/repositories';
import { readStayParams, readUnitIds } from '@main/database/stay-columns';
import { createScopedSecretVault, FakeSecretVault } from '@main/providers/sdk';
import { NotificationType, RelatedType } from '@shared/types/common.types';
import { createMockWatchInput } from '@tests/fixtures/watches';
import { mockBookingInput } from '@tests/fixtures/bookings';
import { logger } from '@main/utils/logger';

describe('provider-aware repositories', () => {
  let dbHelper: TestDatabaseHelper;
  let db: Database.Database;
  /** The local profile migration v8 seeds. */
  const userId = 1;

  beforeEach(async () => {
    dbHelper = new TestDatabaseHelper('provider-aware-repos');
    db = await dbHelper.setup();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await dbHelper.teardown();
  });

  describe('WatchRepository', () => {
    it('round-trips the location, a calendar-date stay, stay params and unit ids', () => {
      const watches = new WatchRepository(db);
      const input = createMockWatchInput({
        stay: { arrival: '2099-12-13', departure: '2099-12-15', adults: 2, children: 1 },
        unitIds: ['136', '137'],
        stayParams: { parkId: '17', gearType: 'tent', powered: false, vehicles: 2 },
      });

      const created = watches.create(userId, input);

      expect(watches.findById(created.id)).toMatchObject({
        providerId: 'parkstay',
        locationKey: 'parkstay:CG001',
        location: input.location,
        stay: {
          arrival: '2099-12-13',
          departure: '2099-12-15',
          adults: 2,
          children: 1,
          infants: 0,
          concessions: 0,
        },
        unitIds: ['136', '137'],
        stayParams: { parkId: '17', gearType: 'tent', powered: false, vehicles: 2 },
      });
      expect(
        db
          .prepare(
            `SELECT provider_id, location_external_id, location_name, area_name, arrival_date,
               departure_date, num_adults, num_children, unit_ids, stay_params
             FROM watches WHERE id = ?`
          )
          .get(created.id)
      ).toEqual({
        provider_id: 'parkstay',
        location_external_id: 'CG001',
        location_name: 'Dales Campground',
        area_name: 'Karijini National Park',
        arrival_date: '2099-12-13',
        departure_date: '2099-12-15',
        num_adults: 2,
        num_children: 1,
        unit_ids: '["136","137"]',
        stay_params: '{"parkId":"17","gearType":"tent","powered":false,"vehicles":2}',
      });
    });

    it('replaces the stay and location whole on update, and keeps what the update leaves out', () => {
      const watches = new WatchRepository(db);
      const created = watches.create(userId, createMockWatchInput());

      const updated = watches.update(created.id, {
        stay: { arrival: '2099-03-01', departure: '2099-03-04', adults: 4 },
        location: { externalId: '88', name: 'Lucky Bay' },
      });

      expect(updated.stay).toEqual({
        arrival: '2099-03-01',
        departure: '2099-03-04',
        adults: 4,
        children: 0,
        infants: 0,
        concessions: 0,
      });
      expect(updated.location).toEqual({ externalId: '88', name: 'Lucky Bay' });
      expect(updated.locationKey).toBe('parkstay:88');
      expect(updated.unitIds).toEqual(created.unitIds);
      expect(updated.stayParams).toEqual(created.stayParams);
      expect(updated.providerId).toBe('parkstay');
    });

    it('clears the max price with 0 on update, storing NULL as create does', () => {
      const watches = new WatchRepository(db);
      const created = watches.create(userId, createMockWatchInput({ maxPrice: 40 }));
      expect(created.maxPrice).toBe(40);

      expect(watches.update(created.id, { maxPrice: 25 }).maxPrice).toBe(25);
      const cleared = watches.update(created.id, { maxPrice: 0 });

      expect(cleared.maxPrice).toBeUndefined();
      const row = db.prepare('SELECT max_price FROM watches WHERE id = ?').get(created.id) as {
        max_price: number | null;
      };
      expect(row.max_price).toBeNull();
      expect(
        watches.create(userId, createMockWatchInput({ maxPrice: 0 })).maxPrice
      ).toBeUndefined();
    });

    it('stores a watch of another provider with no ParkStay fields', () => {
      const watches = new WatchRepository(db);
      const created = watches.create(userId, {
        providerId: 'fake',
        name: 'Elsewhere',
        location: { externalId: 'loc-1', name: 'Somewhere' },
        stay: { arrival: '2099-01-01', departure: '2099-01-02', adults: 1 },
      });

      expect(created).toMatchObject({
        providerId: 'fake',
        locationKey: 'fake:loc-1',
        location: { externalId: 'loc-1', name: 'Somewhere' },
        unitIds: [],
        stayParams: {},
      });
      expect(created.location.areaName).toBeUndefined();
    });
  });

  describe('BookingRepository', () => {
    it('round-trips a booking, working out the nights from the calendar dates', () => {
      const bookings = new BookingRepository(db);
      const created = bookings.create(userId, {
        ...mockBookingInput,
        location: { externalId: '34', name: 'Osprey Bay', areaName: 'Cape Range' },
        stay: { arrival: '2028-02-27', departure: '2028-03-01', adults: 2 },
      });

      expect(bookings.findById(created.id)).toMatchObject({
        providerId: 'parkstay',
        locationKey: 'parkstay:34',
        location: { externalId: '34', name: 'Osprey Bay', areaName: 'Cape Range' },
        stay: { arrival: '2028-02-27', departure: '2028-03-01', adults: 2 },
        unitIds: ['12'],
        stayParams: { siteType: 'Unpowered' },
        numNights: 3, // across the leap day
      });
    });

    it('has no location key when the provider id of the location is unknown', () => {
      const bookings = new BookingRepository(db);
      const created = bookings.create(userId, mockBookingInput);

      expect(created.locationKey).toBeUndefined();
      expect(created.location.externalId).toBeUndefined();
    });

    it('recalculates the nights when an update changes the stay', () => {
      const bookings = new BookingRepository(db);
      const created = bookings.create(userId, mockBookingInput);

      const updated = bookings.update(created.id, {
        stay: { arrival: '2024-06-15', departure: '2024-06-22', adults: 2 },
      });

      expect(updated?.numNights).toBe(7);
      expect(updated?.unitIds).toEqual(['12']);
    });

    it('finds a booking by provider and reference', () => {
      const bookings = new BookingRepository(db);
      const parkstay = bookings.create(userId, mockBookingInput);
      const fake = bookings.create(userId, { ...mockBookingInput, providerId: 'fake' });

      expect(bookings.findByReference('parkstay', mockBookingInput.bookingReference)?.id).toBe(
        parkstay.id
      );
      expect(bookings.findByReference('fake', mockBookingInput.bookingReference)?.id).toBe(fake.id);
      expect(() => bookings.create(userId, mockBookingInput)).toThrow(/UNIQUE/);
    });
  });

  describe('NotificationRepository', () => {
    it('round-trips the provider id, and leaves it out for app-wide notifications', () => {
      const notifications = new NotificationRepository(db);
      const about = notifications.create({
        userId,
        providerId: 'parkstay',
        type: NotificationType.WATCH_FOUND,
        title: 'Found',
        message: 'm',
        relatedId: 1,
        relatedType: RelatedType.WATCH,
      });
      const appWide = notifications.create({
        userId,
        type: NotificationType.INFO,
        title: 'Hello',
        message: 'm',
      });

      expect(notifications.findById(about.id)?.providerId).toBe('parkstay');
      expect(notifications.findById(appWide.id)).not.toHaveProperty('providerId');
    });
  });

  describe('defensive JSON reads', () => {
    it('reads unit ids as strings, and anything but a JSON array as [] with a warning', () => {
      const warn = jest.spyOn(logger, 'warn');

      expect(readUnitIds('["136",137]', 'watches 1')).toEqual(['136', '137']);
      expect(readUnitIds(null, 'watches 1')).toEqual([]);
      expect(readUnitIds('', 'watches 1')).toEqual([]);
      expect(warn).not.toHaveBeenCalled();

      expect(readUnitIds('Site 1, Site 2', 'watches 2')).toEqual([]);
      expect(readUnitIds('{"a":1}', 'watches 3')).toEqual([]);
      expect(warn).toHaveBeenCalledWith('watches 2: unit_ids is not a JSON array; read as []');
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('reads stay params as an object of scalars, and anything else as {} with a warning', () => {
      const warn = jest.spyOn(logger, 'warn');

      expect(
        readStayParams('{"gearType":"tent","numVehicles":1,"ev":true,"x":null,"y":[1]}', 's 1')
      ).toEqual({ gearType: 'tent', numVehicles: 1, ev: true });
      expect(readStayParams(null, 's 1')).toEqual({});
      expect(warn).not.toHaveBeenCalled();

      expect(readStayParams('[1,2]', 's 2')).toEqual({});
      expect(readStayParams('{bad', 's 3')).toEqual({});
      expect(warn).toHaveBeenCalledWith('s 2: stay_params is not a JSON object; read as {}');
      expect(warn).toHaveBeenCalledTimes(2);
    });
  });

  describe('ProviderStateRepository and SqliteKeyValueStore', () => {
    it('stores JSON values per provider and key, replacing and deleting them', () => {
      const state = new ProviderStateRepository(db);

      state.set('parkstay', 'queue.session', { sessionKey: 'A' }, new Date('2026-10-01T00:00:00Z'));
      state.set('parkstay', 'queue.session', { sessionKey: 'B' }, new Date('2026-10-02T00:00:00Z'));
      state.set('fake', 'queue.session', 0);

      expect(state.getEntry('parkstay', 'queue.session')).toEqual({
        key: 'queue.session',
        value: { sessionKey: 'B' },
        updatedAt: new Date('2026-10-02T00:00:00Z'),
      });
      expect(state.get('fake', 'queue.session')).toBe(0);

      state.set('parkstay', 'queue.session', undefined);
      expect(state.get('parkstay', 'queue.session')).toBeUndefined();
      state.delete('fake', 'queue.session');
      expect(db.prepare('SELECT COUNT(*) AS n FROM provider_state').get()).toEqual({ n: 0 });
    });

    it('scopes a store to its provider and lists entries by key prefix, sorted', async () => {
      const repo = new ProviderStateRepository(db);
      const parkstay = new SqliteKeyValueStore(repo, 'parkstay');
      const fake = new SqliteKeyValueStore(repo, 'fake');

      await parkstay.set('secret:b', 'cipher-b');
      await parkstay.set('secret:a', 'cipher-a');
      await parkstay.set('release.cache', { at: 1 });
      await fake.set('secret:a', 'not yours');

      expect(await parkstay.list('secret:')).toEqual([
        { key: 'secret:a', value: 'cipher-a' },
        { key: 'secret:b', value: 'cipher-b' },
      ]);
      expect((await parkstay.list()).map((e) => e.key)).toEqual([
        'release.cache',
        'secret:a',
        'secret:b',
      ]);
      expect(await fake.get('secret:a')).toBe('not yours');
      // A prefix is matched literally, not as a LIKE pattern
      expect(await parkstay.list('secret_')).toEqual([]);

      await parkstay.delete('secret:a');
      expect(await parkstay.get('secret:a')).toBeUndefined();
      expect(await fake.get('secret:a')).toBe('not yours');
    });

    it('persists a scoped secret as ciphertext only, readable by a new store on the same database', async () => {
      const vault = new FakeSecretVault();
      const write = createScopedSecretVault({
        providerId: 'parkstay',
        vault,
        store: new SqliteKeyValueStore(new ProviderStateRepository(db), 'parkstay'),
      });
      await write.set('token', 's3cret-token');

      const stored = db.prepare('SELECT key, value FROM provider_state').all() as {
        key: string;
        value: string;
      }[];
      expect(stored.map((r) => r.key)).toEqual(['secret:token']);
      expect(stored[0].value).not.toContain('s3cret-token');

      const read = createScopedSecretVault({
        providerId: 'parkstay',
        vault,
        store: new SqliteKeyValueStore(new ProviderStateRepository(db), 'parkstay'),
      });
      expect(await read.get('token')).toBe('s3cret-token');
    });
  });

  describe('ProviderAccountRepository', () => {
    it('upserts an account, keeping stored fields an update leaves out and clearing nulls', () => {
      const accounts = new ProviderAccountRepository(db);
      expect(accounts.get('parkstay')).toBeNull();

      const created = accounts.upsert(
        { providerId: 'parkstay', email: 'me@example.com', displayName: 'Me' },
        new Date('2026-10-01T00:00:00Z')
      );
      expect(created).toEqual({
        providerId: 'parkstay',
        status: 'unknown',
        email: 'me@example.com',
        displayName: 'Me',
        createdAt: new Date('2026-10-01T00:00:00Z'),
        updatedAt: new Date('2026-10-01T00:00:00Z'),
      });

      const signedIn = accounts.upsert(
        {
          providerId: 'parkstay',
          status: 'signed-in',
          lastSignedInAt: new Date('2026-10-02T00:00:00Z'),
          displayName: null,
        },
        new Date('2026-10-02T00:00:00Z')
      );
      expect(signedIn).toEqual({
        providerId: 'parkstay',
        status: 'signed-in',
        email: 'me@example.com',
        lastSignedInAt: new Date('2026-10-02T00:00:00Z'),
        createdAt: new Date('2026-10-01T00:00:00Z'),
        updatedAt: new Date('2026-10-02T00:00:00Z'),
      });

      accounts.upsert({ providerId: 'airbnb' });
      expect(accounts.list().map((a) => [a.providerId, a.status])).toEqual([
        ['airbnb', 'unknown'],
        ['parkstay', 'signed-in'],
      ]);
    });
  });
});
