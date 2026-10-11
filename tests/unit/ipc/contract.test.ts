/**
 * Contract parity: every contract method has exactly one registered handler, every
 * registered channel is in the contract, channel names follow `<namespace>:<kebab-method>`,
 * and no request schema accepts a `userId`.
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { contract, CHANNELS, EVENT_NAMES } from '@shared/contracts';
import { DEFAULT_WATCH_INTERVAL, WATCH_INTERVAL_OPTIONS } from '@shared/contracts/watches';
import type { MethodDef } from '@shared/contracts/define';
import { openDatabase } from '@main/database/connection';
import { createContainer, AppContainer } from '@main/app/container';
import { registerIpcHandlers } from '@main/ipc';
import { FakeIpcMain, TEST_LOGS_DIR } from '@tests/utils/ipc-harness';

import { containerSecrets } from '@tests/utils/fake-safe-storage';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

const methods = (): Array<[string, string, MethodDef]> =>
  Object.entries(contract).flatMap(([namespace, defs]) =>
    Object.entries(defs as Record<string, MethodDef>).map(
      ([method, def]) => [namespace, method, def] as [string, string, MethodDef]
    )
  );

const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Every object key a schema accepts, at any depth. */
function schemaKeys(schema: z.core.$ZodType): string[] {
  if (schema instanceof z.ZodObject) {
    return Object.entries(schema.shape as Record<string, z.core.$ZodType>).flatMap(
      ([key, value]) => [key, ...schemaKeys(value)]
    );
  }
  // zod 4 keeps a refinement on the schema itself; a transform or preprocess is a pipe.
  if (schema instanceof z.ZodPipe) return [...schemaKeys(schema.in), ...schemaKeys(schema.out)];
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    return schemaKeys(schema.unwrap());
  }
  if (schema instanceof z.ZodArray) return schemaKeys(schema.element);
  if (schema instanceof z.ZodRecord) return schemaKeys(schema.valueType);
  // A discriminated union is a ZodUnion too.
  if (schema instanceof z.ZodUnion) {
    return (schema.options as z.core.$ZodType[]).flatMap(schemaKeys);
  }
  if (schema instanceof z.ZodIntersection) {
    return [...schemaKeys(schema.def.left), ...schemaKeys(schema.def.right)];
  }
  return [];
}

describe('IPC contract', () => {
  it('names every channel <namespace>:<kebab-method>, matching channels.ts, all unique', () => {
    const all = methods();
    for (const [namespace, method, def] of all) {
      expect(def.channel).toBe(`${namespace}:${kebab(method)}`);
      expect(def.channel).toBe(
        (CHANNELS as Record<string, Record<string, string>>)[namespace][method]
      );
    }
    expect(new Set(all.map(([, , def]) => def.channel)).size).toBe(all.length);

    const channelCount = Object.values(CHANNELS).reduce((n, ns) => n + Object.keys(ns).length, 0);
    expect(channelCount).toBe(all.length);
    // Event names never collide with invoke channels
    const eventNames: readonly string[] = EVENT_NAMES;
    expect(all.map(([, , def]) => def.channel).filter((c) => eventNames.includes(c))).toEqual([]);
  });

  it('watches, snipes and bookings (V4): list filters, the interval options, provider imports, no sync', () => {
    for (const namespace of ['watches', 'snipes', 'bookings'] as const) {
      const list = contract[namespace].list.request;
      expect(list.safeParse(undefined).success).toBe(true);
      expect(list.safeParse({}).success).toBe(true);
      expect(list.safeParse({ providerId: 'parkstay' }).success).toBe(true);
      expect(list.safeParse({ providerId: 'Not An Id' }).success).toBe(false);
    }
    expect(contract.watches.list.request.safeParse({ status: 'active' }).success).toBe(true);
    expect(contract.watches.list.request.safeParse({ status: 'armed' }).success).toBe(false);

    expect(WATCH_INTERVAL_OPTIONS).toEqual([15, 30, 60, 240, 720, 1440]);
    expect(DEFAULT_WATCH_INTERVAL).toBe(60);
    const interval = (minutes: number) =>
      contract.watches.update.request.safeParse({
        id: 1,
        updates: { checkIntervalMinutes: minutes },
      }).success;
    expect(WATCH_INTERVAL_OPTIONS.every(interval)).toBe(true);
    expect([5, 45, 0].some(interval)).toBe(false);
    expect(schemaKeys(contract.watches.create.request)).toContain('autoHold');
    expect(schemaKeys(contract.watches.create.request)).not.toContain('autoBook');

    expect(
      contract.bookings.import.request.safeParse({ providerId: 'parkstay', reference: 'PB123' })
        .success
    ).toBe(true);
    expect(Object.keys(CHANNELS.bookings)).not.toEqual(expect.arrayContaining(['sync']));
    expect(Object.values(CHANNELS.bookings)).not.toContain('bookings:sync-all');
    expect(Object.keys(contract.bookings)).toEqual(expect.not.arrayContaining(['sync', 'syncAll']));
  });

  it('trims a pasted sign-in link and drops tabs and newlines in it (zod 4 z.url())', () => {
    // Pinned so a change to this normalisation is deliberate: main checks the cleaned link.
    const request = contract.accounts.openSignInLink.request;
    const parsed = request.safeParse({
      providerId: 'parkstay',
      url: '  https://parkstay.dbca.wa.gov.au/sso\nlogin?next=%2F\t\n',
    });
    expect(parsed.success && parsed.data.url).toBe(
      'https://parkstay.dbca.wa.gov.au/ssologin?next=%2F'
    );
    for (const url of [' http://parkstay.dbca.wa.gov.au/', 'parkstay.dbca.wa.gov.au', '']) {
      expect(request.safeParse({ providerId: 'parkstay', url }).success).toBe(false);
    }
  });

  it('has no request schema with a key named userId', () => {
    const offenders: string[] = [];
    let keysSeen = 0;
    for (const [namespace, method, def] of methods()) {
      const keys = schemaKeys(def.request);
      keysSeen += keys.length;
      if (keys.includes('userId')) offenders.push(`${namespace}.${method}`);
    }

    expect(offenders).toEqual([]);
    // The walk reaches nested keys, so an empty result means something
    expect(schemaKeys(contract.watches.update.request)).toEqual(
      expect.arrayContaining(['id', 'updates', 'location', 'externalId', 'stay', 'arrival'])
    );
    expect(keysSeen).toBeGreaterThan(80);
  });

  it('has no Gmail namespace (the OTP back end is gone, P7) and no inbox reads anywhere', () => {
    const src = path.resolve(__dirname, '../../../src');
    const files = ['preload', 'shared/contracts', 'renderer'].flatMap((dir) =>
      (fs.readdirSync(path.join(src, dir), { recursive: true }) as string[])
        .map((name) => path.join(src, dir, name))
        .filter((file) => /\.tsx?$/.test(file))
    );
    const offenders = files.filter((file) =>
      /getRecentEmails|testSearch|waitForEmail|['"]gmail:/.test(fs.readFileSync(file, 'utf8'))
    );

    expect(files.length).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
    expect(Object.keys(contract)).not.toContain('gmail');
    expect(Object.keys(CHANNELS)).not.toContain('gmail');
  });

  it('has no transitional auth namespace: ParkStay sign-in is accounts.* (V6)', () => {
    expect(Object.keys(contract)).not.toContain('auth');
    expect(Object.keys(CHANNELS)).not.toContain('auth');
    expect(Object.keys(contract.accounts).sort()).toEqual(
      ['list', 'openSignInLink', 'signIn', 'signOut', 'status'].sort()
    );
  });

  it('pays for holds in the app: snipes.openPayment and watches.openPayment take an id (V6)', () => {
    expect(contract.snipes.openPayment.channel).toBe('snipes:open-payment');
    expect(contract.watches.openPayment.channel).toBe('watches:open-payment');
    for (const method of [contract.snipes.openPayment, contract.watches.openPayment]) {
      expect(method.request.safeParse({ id: 4 }).success).toBe(true);
      expect(method.request.safeParse({ id: 'x' }).success).toBe(false);
    }
  });

  describe('registration', () => {
    let container: AppContainer;
    let ipc: FakeIpcMain;

    beforeEach(() => {
      container = createContainer({
        db: openDatabase(':memory:'),
        logsDir: TEST_LOGS_DIR,
        ...containerSecrets(),
      });
      ipc = new FakeIpcMain();
      registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
    });

    afterEach(() => {
      container.dispose();
    });

    it('registers exactly one handler per contract method and nothing else', () => {
      const expected = methods()
        .map(([, , def]) => def.channel)
        .sort();

      expect([...ipc.registrations].sort()).toEqual(expected);
    });
  });
});
