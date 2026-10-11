/**
 * Secrets never cross to the renderer (architecture-notes §4, §7; tech-review #5).
 *
 * A container on an in-memory database with every handler registered, plus FakeProvider so
 * the catalogue's availability reads return real data: seed a ParkStay account with a session
 * cookie in its partition, a sign-in link carrying a token (pasted through IPC) and an SMTP
 * password, invoke every read channel, and check that none of the seeded strings is in any
 * response or in any log line (captured at debug level). Also: saving SMTP settings without a
 * password keeps the stored one only for the same server and account (so `notifiers:test`
 * cannot send it elsewhere), and no Gmail channel is registered (the OTP back end is gone, P7).
 */

import { Writable } from 'stream';
import winston from 'winston';
import { openDatabase } from '@main/database/connection';
import { createContainer, AppContainer } from '@main/app/container';
import { registerIpcHandlers } from '@main/ipc';
import { parkstayFactory } from '@main/providers/parkstay';
import { logger } from '@main/utils/logger';
import { contract } from '@shared/contracts';
import type { MethodDef } from '@shared/contracts/define';
import { NotifierChannel, SMTPPreset } from '@shared/types';
import type { APIResponse } from '@shared/types';
import { FakeIpcMain, fakeEvent, TEST_LOGS_DIR } from '@tests/utils/ipc-harness';
import type { EmailNotifierView } from '../../src/renderer/api/notifiers';
import {
  canKeepPassword,
  emailFormDefaults,
  toConfigureInput,
} from '../../src/renderer/features/settings/notifications/email/emailForm';
import { createFakeProvider, createTestProviderContext } from '@tests/utils/fake-provider';
import { containerSecrets, removeUserData } from '@tests/utils/fake-safe-storage';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));
// SMTP connections are recorded, never made (`notifiers:test`)
const mockSmtpConnections: Array<{ host: string; port: number; auth: object }> = [];
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: (options: { host: string; port: number; auth: object }) => {
      mockSmtpConnections.push(options);
      return { verify: async () => true, sendMail: async () => ({ messageId: 'test-message' }) };
    },
  },
}));

const SMTP_PASS = 'sweep-smtp-app-password-q9z';
/** A ParkStay session cookie in the provider partition. */
const SESSION_COOKIE = 'SWEEP-SESSION-COOKIE-4c1d';
/** The token of a pasted sign-in (magic) link. */
const MAGIC_TOKEN = 'SWEEP-MAGIC-TOKEN-88ab';
const SECRETS = [SMTP_PASS, SESSION_COOKIE, MAGIC_TOKEN];
const SIGN_IN_LINK = `https://dbcab2c.b2clogin.com/dbcab2c.onmicrosoft.com/oauth2/v2.0/authorize?token=${MAGIC_TOKEN}`;

const STAY = { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 };

const SMTP_CONFIG = {
  preset: SMTPPreset.GMAIL,
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: { user: 'me@example.com', pass: SMTP_PASS },
  toEmail: 'me@example.com',
};

/**
 * Every read channel and its payload; a test below fails if a new get/list/search/status/
 * availability/check method is not added here. The catalogue's search and get are answered
 * from the seeded cache; its availability fans out to FakeProvider (entries) and the
 * container's ParkStay (an error entry: no network in tests), and its location check asks
 * FakeProvider.
 */
const READS: Array<[string, unknown]> = [
  ['accounts:list', undefined],
  // ParkStay's /api/profile check: no network in tests, so the stored account answers
  ['accounts:status', { providerId: 'parkstay' }],
  ['notifiers:list', undefined],
  ['notifiers:get', { channel: NotifierChannel.EMAIL_SMTP }],
  ['settings:get', { key: 'launchOnStartup' }],
  // U4's keys: plain booleans, swept so a key that ever holds more stays covered
  ['settings:get', { key: 'app.startMinimised' }],
  ['settings:get', { key: 'notifications.desktop' }],
  ['settings:get', { key: 'notifications.sound' }],
  // P7's retention periods (main-only numbers)
  ['settings:get', { key: 'retention.notificationDays' }],
  ['settings:get', { key: 'retention.deliveryLogDays' }],
  ['settings:get-all', undefined],
  ['app:get-info', undefined],
  ['app:get-auto-launch', undefined],
  ['updater:get-status', undefined],
  ['providers:access-status', { providerId: 'parkstay' }],
  ['bookings:list', undefined],
  ['bookings:get', { id: 1 }],
  ['watches:list', undefined],
  ['watches:get', { id: 1 }],
  ['snipes:list', undefined],
  ['snipes:get', { id: 1 }],
  ['notifications:list', { limit: 50 }],
  ['providers:list', undefined],
  ['catalog:search', { text: 'sweep', limit: 50 }],
  ['catalog:get', { key: 'parkstay:20' }],
  ['catalog:status', undefined],
  ['catalog:availability', { stay: STAY }],
  ['catalog:check-location', { key: 'fake:1', stay: STAY }],
];

/** Methods whose names look like reads but are actions. */
const NOT_READS = new Set([
  // Asks GitHub for a new release
  'updater:check-for-updates',
]);

describe('secrets never reach the renderer', () => {
  let container: AppContainer;
  let userDataDir: string;
  let ipc: FakeIpcMain;
  let logLines: string[];
  let capture: winston.transport;
  const levelBefore = logger.level;

  const call = <T = unknown>(channel: string, payload?: unknown): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;

  beforeEach(() => {
    // Capture every log line, debug included; keep the console quiet
    logLines = [];
    capture = new winston.transports.Stream({
      stream: new Writable({
        write(chunk, _encoding, done) {
          logLines.push(String(chunk));
          done();
        },
      }),
    });
    logger.add(capture);
    logger.level = 'debug';
    for (const transport of logger.transports) {
      if (transport !== capture) transport.silent = true;
    }

    const secrets = containerSecrets();
    userDataDir = secrets.userDataDir;
    // The seeded secrets are ParkStay's: ParkStay alone, however many providers are built in
    container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...secrets,
      providerFactories: [parkstayFactory],
    });
    container.profile.ensureLocalProfile();
    container.providers.register(createFakeProvider().factory, createTestProviderContext);
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
  });

  afterEach(() => {
    container.dispose();
    removeUserData(userDataDir);
    logger.remove(capture);
    logger.level = levelBefore;
    for (const transport of logger.transports) transport.silent = false;
  });

  /** A cached ParkStay location with a fresh detail, so `catalog:get` reads the cache. */
  function seedCatalogue(): void {
    const now = new Date();
    const location = {
      key: 'parkstay:20',
      providerId: 'parkstay',
      externalId: '20',
      name: 'Sweep Bay',
      kind: 'campground' as const,
      bookingMode: 'online' as const,
      lat: -22.247,
      lng: 113.84,
      area: { name: 'Cape Range National Park', region: 'Pilbara' },
      imageUrls: [],
      amenities: ['Toilet'],
    };
    const { locations } = container.repositories;
    locations.upsertMany('parkstay', [location], now);
    locations.setDetail(
      'parkstay',
      '20',
      { ...location, descriptionHtml: '<p>Red cliffs</p>', units: [] },
      now
    );
  }

  /** A signed-in ParkStay account, whose session cookie is in the provider partition. */
  function seedAccount(): void {
    container.repositories.providerAccounts.upsert({
      providerId: 'parkstay',
      status: 'signed-in',
      email: 'me@example.com',
      displayName: 'Sweep Person',
    });
    const { session } = jest.requireMock('electron') as {
      session: { fromPartition(partition: string): { cookies: { get: jest.Mock } } };
    };
    session.fromPartition('persist:provider-parkstay').cookies.get.mockResolvedValue([
      {
        name: 'sessionid',
        value: SESSION_COOKIE,
        domain: 'parkstay.dbca.wa.gov.au',
        path: '/',
        secure: true,
        httpOnly: true,
        session: true,
      },
    ]);
  }

  async function seed(): Promise<unknown[]> {
    seedCatalogue();
    seedAccount();
    await container.catalogService.sync('fake');
    return [
      // A pasted sign-in link: main loads it in the sign-in window, never logs its token
      await call('accounts:open-sign-in-link', { providerId: 'parkstay', url: SIGN_IN_LINK }),
      await call('notifiers:configure', {
        channel: NotifierChannel.EMAIL_SMTP,
        displayName: 'Email (SMTP)',
        enabled: true,
        config: SMTP_CONFIG,
      }),
    ];
  }

  it('sweeps every read channel: no seeded secret in any response or log line', async () => {
    const responses: unknown[] = await seed();
    for (const [channel, payload] of READS) responses.push(await call(channel, payload));

    // The seeding worked and every read succeeded (a failing read would prove nothing)
    expect(responses.filter((response) => !(response as APIResponse).success)).toEqual([]);
    // The catalogue reads returned the seeded location
    expect(await call('catalog:get', { key: 'parkstay:20' })).toMatchObject({
      success: true,
      data: { key: 'parkstay:20', name: 'Sweep Bay', descriptionHtml: '<p>Red cliffs</p>' },
    });
    expect(await call('catalog:search', { text: 'sweep' })).toMatchObject({
      success: true,
      data: { total: 1, items: [{ key: 'parkstay:20' }] },
    });
    // The availability reads returned FakeProvider's data
    expect(await call('catalog:availability', { stay: STAY })).toMatchObject({
      success: true,
      data: {
        entries: [
          { key: 'fake:1', availableUnits: 1, bookableUnits: 2 },
          { key: 'fake:2', availableUnits: 1, bookableUnits: 2 },
          { key: 'fake:area:3', availableUnits: 1, bookableUnits: 2 },
        ],
        errors: [{ providerId: 'parkstay' }],
      },
    });
    expect(await call('catalog:check-location', { key: 'fake:1', stay: STAY })).toMatchObject({
      success: true,
      data: { key: 'fake:1', units: [{ unitId: 'u1' }, { unitId: 'u2' }] },
    });

    const serialised = JSON.stringify(responses);
    const logs = logLines.join('\n');
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of SECRETS) {
      expect(serialised).not.toContain(secret);
      expect(logs).not.toContain(secret);
    }

    // What the renderer gets instead: the account's status, email and name, nothing else
    await expect(call('accounts:list')).resolves.toEqual({
      success: true,
      data: [
        // FakeProvider's account is optional too, never checked
        { providerId: 'fake', requirement: 'optional', status: 'unknown' },
        {
          providerId: 'parkstay',
          requirement: 'optional',
          status: 'signed-in',
          email: 'me@example.com',
          displayName: 'Sweep Person',
        },
      ],
    });
    const notifier = await call<Record<string, unknown>>('notifiers:get', {
      channel: NotifierChannel.EMAIL_SMTP,
    });
    expect(notifier.data).toMatchObject({
      hasPassword: true,
      config: { auth: { user: 'me@example.com' } },
    });
    expect((notifier.data?.config as { auth: object }).auth).not.toHaveProperty('pass');

    // The sign-in link did reach its window, and the session cookie its partition
    const { BrowserWindow } = jest.requireMock('electron') as {
      BrowserWindow: { instances: Array<{ loadURL: jest.Mock }> };
    };
    expect(BrowserWindow.instances.at(-1)?.loadURL).toHaveBeenCalledWith(SIGN_IN_LINK);
  });

  it('the sweep covers every get/list/search/status/availability/check channel', () => {
    const swept = new Set(READS.map(([channel]) => channel));
    const reads = Object.values(contract)
      .flatMap((methods) => Object.entries(methods as Record<string, MethodDef>))
      .filter(([method]) =>
        /^(get|list|validate|search|status|availability|check)|Status$/.test(method)
      )
      .map(([, def]) => def.channel)
      .filter((channel) => !NOT_READS.has(channel));

    expect(reads.filter((channel) => !swept.has(channel))).toEqual([]);
    expect(reads).toEqual(
      expect.arrayContaining([
        'catalog:availability',
        'catalog:check-location',
        'accounts:list',
        'accounts:status',
      ])
    );
  });

  it('notifiers.configure without a password keeps the stored one for the same server and account, in the database and the dispatcher', async () => {
    await seed();
    const dispatcherPass = (): unknown =>
      (
        container.notifierDispatcher.getNotifier(NotifierChannel.EMAIL_SMTP)?.getConfig() as {
          auth: { pass: string };
        }
      ).auth.pass;

    const withoutPassword = {
      ...SMTP_CONFIG,
      toEmail: 'other@example.com',
      auth: { user: 'me@example.com' },
    };
    const blank = {
      ...SMTP_CONFIG,
      host: 'SMTP.Gmail.com',
      secure: true,
      auth: { user: 'me@example.com', pass: '' },
    };

    for (const config of [withoutPassword, blank]) {
      const saved = await call<Record<string, unknown>>('notifiers:configure', {
        channel: NotifierChannel.EMAIL_SMTP,
        displayName: 'Email (SMTP)',
        enabled: true,
        config,
      });
      expect(saved).toMatchObject({ success: true, data: { hasPassword: true } });
      expect(JSON.stringify(saved)).not.toContain(SMTP_PASS);
      expect(dispatcherPass()).toBe(SMTP_PASS);
      expect(
        (
          container.repositories.notifiers.findByChannel(NotifierChannel.EMAIL_SMTP)?.config as {
            auth: { pass: string };
          }
        ).auth.pass
      ).toBe(SMTP_PASS);
    }

    // The other settings did change
    expect(
      container.notifierDispatcher.getNotifier(NotifierChannel.EMAIL_SMTP)?.getConfig()
    ).toMatchObject({
      secure: true,
    });

    // A new password replaces it
    await call('notifiers:configure', {
      channel: NotifierChannel.EMAIL_SMTP,
      displayName: 'Email (SMTP)',
      enabled: true,
      config: { ...SMTP_CONFIG, auth: { user: 'me@example.com', pass: 'a-new-one' } },
    });
    expect(dispatcherPass()).toBe('a-new-one');
  });

  it("Settings' email form (U4) saves without the password it never sees, and gets none back", async () => {
    await seed();
    const stored = await call<EmailNotifierView>('notifiers:get', {
      channel: NotifierChannel.EMAIL_SMTP,
    });
    expect(stored.success).toBe(true);
    const view = (stored as { data: EmailNotifierView }).data;
    expect(view.hasPassword).toBe(true);

    // What the form sends when the person only changes the recipient: no password
    const values = { ...emailFormDefaults(view), toEmail: 'alerts@example.com' };
    expect(canKeepPassword(view, values)).toBe(true);
    const input = toConfigureInput(values, { sendPassword: false, enabled: view.enabled });
    expect(input.config.auth).toEqual({ user: 'me@example.com' });

    const saved = await call('notifiers:configure', input);
    expect(saved).toMatchObject({ success: true, data: { hasPassword: true } });
    expect(JSON.stringify(saved)).not.toContain(SMTP_PASS);
    const test = await call('notifiers:test', { channel: NotifierChannel.EMAIL_SMTP });
    expect(test).toMatchObject({ success: true, data: { success: true } });
    expect(JSON.stringify(test)).not.toContain(SMTP_PASS);
    // The test connected with the stored password, to the stored server
    expect(mockSmtpConnections.at(-1)).toMatchObject({
      host: 'smtp.gmail.com',
      auth: { user: 'me@example.com', pass: SMTP_PASS },
    });
  });

  it('a renderer cannot point the stored SMTP password at another server or account, so notifiers.test cannot either', async () => {
    await seed();
    const storedConfig = (): unknown =>
      container.repositories.notifiers.findByChannel(NotifierChannel.EMAIL_SMTP)?.config;
    const before = storedConfig();
    const configure = (config: object): Promise<APIResponse> =>
      call('notifiers:configure', {
        channel: NotifierChannel.EMAIL_SMTP,
        displayName: 'Email (SMTP)',
        enabled: true,
        config,
      });

    for (const change of [
      { host: 'smtp.attacker.example' },
      { port: 2525 },
      { auth: { user: 'attacker@example.com' } },
      { auth: { user: 'attacker@example.com', pass: '' } },
    ]) {
      await expect(
        configure({ ...SMTP_CONFIG, auth: { user: 'me@example.com' }, ...change })
      ).resolves.toEqual({
        success: false,
        code: 'VALIDATION',
        error: 'Enter the password for the new server/account',
      });
    }
    expect(storedConfig()).toEqual(before);

    // The test connects with what is stored: the original server, account and password
    mockSmtpConnections.length = 0;
    await expect(
      call('notifiers:test', { channel: NotifierChannel.EMAIL_SMTP })
    ).resolves.toMatchObject({ success: true, data: { success: true } });
    expect(mockSmtpConnections).toEqual([
      expect.objectContaining({
        host: 'smtp.gmail.com',
        port: 587,
        auth: { user: 'me@example.com', pass: SMTP_PASS },
      }),
    ]);

    // With a new password the new server is stored, and tested with that password only
    await expect(
      configure({
        ...SMTP_CONFIG,
        host: 'smtp.other.example',
        auth: { user: 'me@example.com', pass: 'other-server-password' },
      })
    ).resolves.toMatchObject({ success: true, data: { hasPassword: true } });
    mockSmtpConnections.length = 0;
    await call('notifiers:test', { channel: NotifierChannel.EMAIL_SMTP });
    expect(mockSmtpConnections).toEqual([
      expect.objectContaining({
        host: 'smtp.other.example',
        auth: { user: 'me@example.com', pass: 'other-server-password' },
      }),
    ]);
    expect(JSON.stringify(mockSmtpConnections)).not.toContain(SMTP_PASS);
  });

  it('notifiers.configure with no stored password and none given is VALIDATION', async () => {
    await expect(
      call('notifiers:configure', {
        channel: NotifierChannel.EMAIL_SMTP,
        displayName: 'Email (SMTP)',
        enabled: true,
        config: { ...SMTP_CONFIG, auth: { user: 'me@example.com' } },
      })
    ).resolves.toEqual({ success: false, code: 'VALIDATION', error: 'A password is required' });
    expect(container.repositories.notifiers.findAll()).toEqual([]);
  });

  it('notifiers.configure validates the SMTP settings', async () => {
    const bad = await call('notifiers:configure', {
      channel: NotifierChannel.EMAIL_SMTP,
      displayName: 'Email (SMTP)',
      config: { ...SMTP_CONFIG, port: 'smtp', host: '' },
    });
    expect(bad).toMatchObject({ success: false, code: 'VALIDATION' });
    expect((bad as APIResponse).issues).toEqual(
      expect.arrayContaining(['config.port', 'config.host'])
    );
  });

  it('no Gmail channel is registered: neither the inbox reads nor the OTP sign-in', async () => {
    expect(ipc.registrations.filter((channel) => channel.startsWith('gmail:'))).toEqual([]);
    for (const channel of [
      'gmail:get-recent-emails',
      'gmail:test-search',
      'gmail:wait-for-email',
      'gmail:set-credentials',
      'gmail:get-credentials',
      'gmail:authorize',
      'gmail:check-auth-status',
      'gmail:revoke-auth',
    ]) {
      expect(ipc.registrations).not.toContain(channel);
      expect(() => ipc.invoke(channel, fakeEvent(), {})).toThrow(
        `No handler registered for ${channel}`
      );
    }
  });
});
