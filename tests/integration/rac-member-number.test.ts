/**
 * An RAC member number end to end in a real container (terms rules 11, 12 and 14; brief RO4):
 * the built-in RAC module, registered on the container's own vault, state and logger, with an
 * HTTP client that records every request and answers from RAC's trimmed fixtures; every IPC
 * handler through P3's harness; nodemailer's transport replaced. 10 am Perth, 17 Oct 2026.
 *
 * - **The number never leaves** (rule 12). A made-up number, `1234567890123`, typed as
 *   `1234-5678-90123` and saved through `accounts.saveCredentials`, is in no RAC request (a
 *   catalogue `get`, a check, a bulk search, a release compute: URL, headers or body), no log
 *   line (debug included), no IPC answer (`accounts.list`, `accounts.status`, `providers.list`,
 *   `catalog.checkLocation`, `catalog.get`), and not in a watch alert's notification or email.
 *   Its only use shows: member prices. A split stay booked through the park carries none of it
 *   either: not the place page's split stays or their contact link, the alert or its email.
 * - **A change asks again.** After a save or a removal the next check goes to RAC instead of
 *   the 60 s cache, priced for the person as they are now; replacing it twice quickly ends with
 *   the last.
 * - **Snipes re-arm.** An armed snipe moves to the member pre-sale when the number is saved
 *   (48 h earlier) and back to the public release when it is removed; saved during the
 *   pre-sale's window, it checks at once, and after it, it stays armed for the public release.
 * - **Removing is never refused** (no `ACCOUNT_BUSY`) while an RAC snipe is armed, and clears
 *   no session partition.
 *
 * Every number here is made up; no request leaves the test.
 */

import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';
import type Mail from 'nodemailer/lib/mailer';
import winston from 'winston';
import { createContainer, type AppContainer } from '@main/app/container';
import { openDatabase } from '@main/database/connection';
import { SqliteKeyValueStore } from '@main/database/repositories';
import { registerIpcHandlers } from '@main/ipc';
import { parkstayFactory } from '@main/providers/parkstay';
import { RAC_PARKS, racFactory } from '@main/providers/rac';
import { RAC_AVAILABILITY_PATH } from '@main/providers/rac/availability';
import { createProviderContext, type HopRequest } from '@main/providers/sdk';
import { logger } from '@main/utils/logger';
import { SnipeReleaseMode, SnipeStatus } from '@shared/types/common.types';
import { NotifierChannel } from '@shared/types/notifier.types';
import type {
  APIResponse,
  LocationAvailability,
  LocationCheck,
  ProviderAccount,
  SiteSnipe,
  Watch,
} from '@shared/types';
import { fakeDateOnly } from '@tests/utils/core-harness';
import { RecordingHttpClient, type HopAnswer } from '@tests/utils/fake-paced-provider';
import { TEST_PROVIDERS_DIR } from '@tests/utils/fake-provider';
import { containerSecrets, removeUserData } from '@tests/utils/fake-safe-storage';
import {
  FakeIpcMain,
  fakeEvent,
  fakeWebContents,
  TEST_LOGS_DIR,
  TRUSTED_SENDER_ID,
  type FakeWebContents,
} from '@tests/utils/ipc-harness';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));
const mockSendMail = jest.fn(async (_options: Mail.Options) => ({ messageId: 'message-1' }));
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail, verify: jest.fn() })) },
}));

/** Made up, never a real member number (RS13): saved as typed, and stored as digits. */
const NUMBER = '1234567890123';
const TYPED = '1234-5678-90123';
const SENTINELS = [NUMBER, TYPED];
const ANOTHER = '012345678';

/** 10 am in Perth, 17 Oct 2026, the day after the answers were recorded. */
const NOW = new Date('2026-10-17T02:00:00.000Z');
const STAY = { arrival: '2026-11-06', departure: '2026-11-08', adults: 2 };
/** 20–21 Dec 2027, in the summer 2027–28 holidays. */
const HOLIDAYS = { arrival: '2027-12-20', departure: '2027-12-22', adults: 2 };
/** The public release at Busselton, 8 am Perth on 5 Feb 2027, and the members' pre-sale. */
const PUBLIC_RELEASE = '2027-02-05T00:00:00.000Z';
const PRE_SALE = '2027-02-03T00:00:00.000Z';
const STATEMENTS = ['ownNumber', 'willStay', 'nameOnCard'];

const RAC_FIXTURES = path.join(__dirname, '../fixtures/providers/rac');
const read = (file: string) => fs.readFileSync(path.join(RAC_FIXTURES, file), 'utf8');

/** Each park's recorded answer for 6–8 Nov 2026, moved to the holidays for a holiday stay. */
function availabilityAnswer(slug: string, arrival: string): string {
  const text = read(`availability-${slug}-2026-11-06-2n.json`);
  if (arrival !== HOLIDAYS.arrival) return text;
  return text
    .replaceAll('2026-11-06', '2027-12-20')
    .replaceAll('2026-11-07', '2027-12-21')
    .replaceAll('2026-11-08', '2027-12-22');
}

/**
 * Whether Busselton's ensuite sites answer free every night, but on no one site (stay-through 0,
 * code 3): a split stay RAC's own mapping reports as booked through the park.
 */
let ensuiteOnNoOneSite = false;

/** Busselton's answer for 6–8 Nov 2026, its ensuite sites free every night on no one site. */
function ensuiteSplitAnswer(text: string): string {
  const json = JSON.parse(text) as { data: Record<string, Record<string, unknown>> };
  Object.assign(json.data['7'], {
    sites_available: { '2026-11-06': 4, '2026-11-07': 3 },
    sites_code: { '2026-11-06': 0, '2026-11-07': 0 },
    stay_through_sites_available: 0,
    stay_through_sites_code: 3,
  });
  return JSON.stringify(json);
}

/** What RAC's host answers: Busselton's book-now page, and each park's availability. */
function racAnswer(hop: HopRequest): HopAnswer {
  const url = new URL(hop.url);
  if (hop.method === 'GET' && url.pathname === '/busselton/book-now/') {
    return { body: read('book-now-busselton.html'), headers: { 'content-type': 'text/html' } };
  }
  if (hop.method === 'GET' && url.pathname === '/bookings/') {
    return { body: read('parks-page.html'), headers: { 'content-type': 'text/html' } };
  }
  // A park's home page (`/<slug>/`): the synthetic one
  if (hop.method === 'GET' && RAC_PARKS.some((p) => url.pathname === `/${p.slug}/`)) {
    return { body: read('park-home.html'), headers: { 'content-type': 'text/html' } };
  }
  if (hop.method === 'POST' && url.pathname === RAC_AVAILABILITY_PATH) {
    const form = new URLSearchParams(hop.body);
    const park = RAC_PARKS.find((p) => String(p.blogId) === form.get('blog_id'));
    const arrival = form.get('available_from') === '20 Dec 2027' ? HOLIDAYS.arrival : '';
    if (park) {
      const body = availabilityAnswer(park.slug, arrival);
      const split = ensuiteOnNoOneSite && park.slug === 'busselton' && !arrival;
      return {
        body: split ? ensuiteSplitAnswer(body) : body,
        headers: { 'content-type': 'application/json' },
      };
    }
  }
  return { status: 404, body: 'not in the fixtures' };
}

describe('an RAC member number in the app', () => {
  let container: AppContainer;
  let userDataDir: string;
  let ipc: FakeIpcMain;
  let renderer: FakeWebContents;
  let http: RecordingHttpClient;
  let logLines: string[];
  let capture: winston.transport;
  const levelBefore = logger.level;

  const call = <T = unknown>(channel: string, payload?: unknown): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;
  const ok = async <T>(pending: Promise<APIResponse<T>>): Promise<T> => {
    const response = await pending;
    if (!response.success) throw new Error(`${response.code}: ${response.error}`);
    return response.data as T;
  };
  const save = (memberNumber: string) =>
    call<ProviderAccount>('accounts:save-credentials', {
      providerId: 'rac',
      values: { memberNumber },
      confirmed: STATEMENTS,
    });
  const remove = () => call<ProviderAccount>('accounts:sign-out', { providerId: 'rac' });
  const check = (stay = STAY) =>
    call<LocationAvailability>('catalog:check-location', { key: 'rac:busselton', stay });
  const powered = (availability: LocationAvailability) =>
    availability.units.find((unit) => unit.unitId === 'cat:4');
  /** What the person is shown for Busselton's powered site. */
  const price = async () => {
    const site = powered(await ok(check()));
    return { total: site?.total, note: site?.priceNote };
  };
  /** Until `predicate` holds (real timers: only `Date` is fake), at most 5 s. */
  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 500 && !predicate(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(predicate()).toBe(true);
  };
  const snipeOf = (id: number) => container.repositories.snipes.findById(id)!;

  /**
   * The catalogue sync. Its one request, RAC's parks page (for the cards' photos, before any
   * number is saved), is set aside: what follows counts from there.
   */
  async function sync(): Promise<void> {
    await container.catalogService.sync('rac');
    expect(http.requests.map((r) => [r.method, new URL(r.url).pathname])).toEqual([
      ['GET', '/bookings/'],
    ]);
    http.requests.splice(0);
  }

  function start(now = NOW): void {
    fakeDateOnly(now);
    ensuiteOnNoOneSite = false;
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
    mockSendMail.mockClear();

    const secrets = containerSecrets();
    userDataDir = secrets.userDataDir;
    container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...secrets,
      providerFactories: [parkstayFactory],
    });
    container.profile.ensureLocalProfile();
    // The built-in RAC module, as the container builds a provider, with a recording client
    http = new RecordingHttpClient({ providerId: 'rac', respond: racAnswer });
    container.providers.register(racFactory, (manifest) =>
      createProviderContext(manifest, {
        createHttp: () => http,
        createState: (id) => new SqliteKeyValueStore(container.repositories.providerState, id),
        vault: container.vault,
        logger,
        providersDir: TEST_PROVIDERS_DIR,
        unpaced: true,
      })
    );
    renderer = fakeWebContents(TRUSTED_SENDER_ID);
    container.trustedWebContents.register(renderer);
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
  }

  afterEach(async () => {
    await container.dispose();
    removeUserData(userDataDir);
    logger.remove(capture);
    logger.level = levelBefore;
    for (const transport of logger.transports) transport.silent = false;
    jest.useRealTimers();
  });

  it('is in no RAC request, log line, IPC answer, alert or email; only member prices show it was saved', async () => {
    start();
    await sync();
    const responses: unknown[] = [];
    const answer = async <T>(pending: Promise<APIResponse<T>>): Promise<T> => {
      const response = await pending;
      responses.push(response);
      return ok(Promise.resolve(response));
    };

    // Saved as typed; RAC's sign-in keeps the digits, and sends nothing
    const saved = await answer(save(TYPED));
    expect(saved).toMatchObject({
      providerId: 'rac',
      authKind: 'credentials',
      requirement: 'optional',
      status: 'signed-in',
      savedFields: ['memberNumber'],
    });
    expect(http.requests).toEqual([]);

    // A catalogue sync with the number saved: RAC's parks page, and nothing of the number
    await container.catalogService.sync('rac', { force: true });
    expect(http.requests.map((r) => [r.method, new URL(r.url).pathname])).toEqual([
      ['GET', '/bookings/'],
    ]);

    // Everything a window can read about RAC and its account
    await answer(call('accounts:list'));
    await answer(call('accounts:status', { providerId: 'rac' }));
    await answer(call('providers:list'));
    const detail = await answer(call('catalog:get', { key: 'rac:busselton' }));
    // Its book-now page and its home page, whose intro is About
    expect(detail).toMatchObject({
      key: 'rac:busselton',
      descriptionHtml: expect.stringContaining('Made-up introduction'),
    });
    expect(http.requests.slice(1).map((r) => [r.method, new URL(r.url).pathname])).toEqual([
      ['GET', '/busselton/book-now/'],
      ['GET', '/busselton/'],
    ]);
    const checked = await answer(check());
    // The number's only trace: a member's price, and the book-now page as a member
    expect(powered(checked)).toMatchObject({ total: 136, priceNote: 'RAC member rate' });
    expect(new URL(checked.bookingUrl!).searchParams.get('membership_type')).toBe('member');
    const bulk = await answer(call('catalog:availability', { stay: STAY, providerIds: ['rac'] }));
    expect(bulk).toMatchObject({ errors: [] });
    // A release compute (no request), for a snipe in the holidays: the pre-sale
    const snipe = await answer(
      call<SiteSnipe>('snipes:create', {
        providerId: 'rac',
        name: 'Busselton, summer',
        location: { externalId: 'busselton', name: 'RAC Busselton Holiday Park' },
        stay: HOLIDAYS,
        releaseMode: SnipeReleaseMode.DAILY_ROLLOVER,
      })
    );
    expect(new Date(snipe.releaseAt!).toISOString()).toBe(PRE_SALE);
    const rac = container.providers.get('rac');
    await expect(
      rac.release!.computeReleaseAt({
        mode: SnipeReleaseMode.DAILY_ROLLOVER,
        externalId: 'busselton',
        stay: HOLIDAYS,
        now: new Date(),
      })
    ).resolves.toEqual(new Date(PRE_SALE));

    // A watch alert and its email
    container.notifierDispatcher.configureNotifier(
      NotifierChannel.EMAIL_SMTP,
      {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: { user: 'me@example.com', pass: 'made-up-password' },
      },
      true
    );
    const watch = await answer(
      call<Watch>('watches:create', {
        providerId: 'rac',
        name: 'Busselton, November',
        location: { externalId: 'busselton', name: 'RAC Busselton Holiday Park' },
        stay: STAY,
        unitKinds: ['campsite'],
      })
    );
    await answer(call('watches:run-now', { id: watch.id }));
    const notifications = container.db
      .prepare("SELECT title, message FROM notifications WHERE provider_id = 'rac'")
      .all();
    expect(notifications).toHaveLength(1);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.text).toContain('Book on RAC');

    // Each request RAC saw: the sync's parks page, the detail's book-now and home pages, the
    // check, the bulk search and the watch's check
    expect(http.requests.length).toBeGreaterThanOrEqual(1 + 2 + 1 + RAC_PARKS.length + 1);
    const requests = JSON.stringify(
      http.requests.map(({ method, url, headers, body }) => ({ method, url, headers, body }))
    );
    const logs = logLines.join('\n');
    // The logs say what happened, by key name only
    expect(logs).toContain('Account rac: details saved');
    const updates = renderer.sent.filter(([name]) => name === 'account:updated');
    expect(updates.length).toBeGreaterThanOrEqual(1);
    for (const sentinel of SENTINELS) {
      expect(requests).not.toContain(sentinel);
      expect(logs).not.toContain(sentinel);
      expect(JSON.stringify(responses)).not.toContain(sentinel);
      expect(JSON.stringify(updates)).not.toContain(sentinel);
      expect(JSON.stringify(notifications)).not.toContain(sentinel);
      expect(JSON.stringify([mail.subject, mail.text, mail.html])).not.toContain(sentinel);
    }
  });

  it('a split-stay alert carries no number: not the place page’s split stays, their link, the alert or its email', async () => {
    start();
    await sync();
    await ok(save(TYPED));
    // Busselton's ensuite sites free every night on no one site: RAC's own answer, edited, which
    // RAC's mapping reports as a split stay booked through the park, priced at the member rate
    ensuiteOnNoOneSite = true;
    const responses: unknown[] = [];
    const record = async <T>(pending: Promise<APIResponse<T>>): Promise<T> => {
      const response = await pending;
      responses.push(response);
      return ok(Promise.resolve(response));
    };

    const checked = await record(
      call<LocationCheck>('catalog:check-location', { key: 'rac:busselton', stay: STAY })
    );
    const split = checked.units.find((unit) => unit.splitStay);
    expect(split).toMatchObject({
      unitId: 'cat:7',
      unitName: 'Ensuite Site',
      splitStay: { booking: 'contact' },
      freeCount: 0,
      priceNote: 'RAC member rate',
    });
    expect(split!.nights.map((night) => [night.reason, night.price])).toEqual([
      ['split', 115],
      ['split', 117],
    ]);
    expect(checked.splitStays).toEqual([
      expect.objectContaining({
        booking: 'contact',
        unitId: split!.unitId,
        total: 232,
        contactUrl: 'https://parksandresorts.rac.com.au/busselton/contact-us/',
      }),
    ]);

    container.notifierDispatcher.configureNotifier(
      NotifierChannel.EMAIL_SMTP,
      {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: { user: 'me@example.com', pass: 'made-up-password' },
      },
      true
    );
    const watch = await record(
      call<Watch>('watches:create', {
        providerId: 'rac',
        name: 'Busselton, November',
        location: { externalId: 'busselton', name: 'RAC Busselton Holiday Park' },
        stay: STAY,
        unitIds: [split!.unitId],
        allowSplitStay: true,
      })
    );
    await record(call('watches:run-now', { id: watch.id }));
    const found = await record(call<Watch>('watches:get', { id: watch.id }));
    expect(found).toMatchObject({ lastResult: 'split_found', splitStays: checked.splitStays });
    const notifications = container.db
      .prepare("SELECT title, message FROM notifications WHERE provider_id = 'rac'")
      .all();
    expect(notifications).toEqual([
      expect.objectContaining({ title: 'Free if you move sites at RAC Busselton Holiday Park' }),
    ]);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.text).toContain(
      `How to book\nContact RAC Busselton Holiday Park: ${checked.splitStays[0].contactUrl}\n`
    );

    const requests = JSON.stringify(
      http.requests.map(({ method, url, headers, body }) => ({ method, url, headers, body }))
    );
    const logs = logLines.join('\n');
    for (const sentinel of SENTINELS) {
      expect(requests).not.toContain(sentinel);
      expect(logs).not.toContain(sentinel);
      expect(JSON.stringify(responses)).not.toContain(sentinel);
      expect(JSON.stringify(notifications)).not.toContain(sentinel);
      expect(JSON.stringify([mail.subject, mail.text, mail.html])).not.toContain(sentinel);
      expect(JSON.stringify(renderer.sent)).not.toContain(sentinel);
    }
  });

  it('refuses a number in the wrong form in its own words, quoting nothing and storing nothing', async () => {
    start();
    for (const typed of ['abc', '12AB34', '123', '12345678901234567']) {
      const refused = await save(typed);
      expect(refused).toEqual({
        success: false,
        code: 'VALIDATION',
        error: "That doesn't look like an RAC member number",
        issues: ['values.memberNumber'],
      });
    }
    const account = (await ok(call<ProviderAccount[]>('accounts:list'))).find(
      (a) => a.providerId === 'rac'
    );
    expect(account).toMatchObject({ status: 'signed-out', savedFields: [] });
    // Every statement is needed (rule 11), checked before RAC's format is
    await expect(
      call('accounts:save-credentials', {
        providerId: 'rac',
        values: { memberNumber: NUMBER },
        confirmed: STATEMENTS.slice(0, 2),
      })
    ).resolves.toMatchObject({ success: false, code: 'VALIDATION', issues: ['confirmed'] });
    expect(http.requests).toEqual([]);
  });

  it('asks RAC again after each change, priced for the person as they are now; two quick replaces end with the last', async () => {
    start();
    await sync();
    await expect(price()).resolves.toEqual({ total: 150, note: undefined });
    expect(http.requests).toHaveLength(1);
    await expect(price()).resolves.toEqual({ total: 150, note: undefined });
    expect(http.requests).toHaveLength(1); // the 60 s cache

    await ok(save(NUMBER));
    await expect(price()).resolves.toEqual({ total: 136, note: 'RAC member rate' });
    expect(http.requests).toHaveLength(2);

    // Replaced twice at once: no error, and the last one stays
    const [first, second] = await Promise.all([save(ANOTHER), save(TYPED)]);
    expect([first.success, second.success]).toEqual([true, true]);
    await expect(container.providers.secretsOf('rac').get('account.memberNumber')).resolves.toBe(
      NUMBER
    );
    await expect(price()).resolves.toEqual({ total: 136, note: 'RAC member rate' });
    expect(http.requests).toHaveLength(3);

    await ok(remove());
    await expect(price()).resolves.toEqual({ total: 150, note: undefined });
    expect(http.requests).toHaveLength(4);
  });

  it('re-arms an armed snipe for the pre-sale when the number is saved, and for the public release when it is removed; removing is never refused and clears no session', async () => {
    start();
    container.scheduler.start();
    const clear = jest.spyOn(container.providerWindows, 'clear');
    const snipe = await ok(
      call<SiteSnipe>('snipes:create', {
        providerId: 'rac',
        name: 'Busselton, summer',
        location: { externalId: 'busselton', name: 'RAC Busselton Holiday Park' },
        stay: HOLIDAYS,
        releaseMode: SnipeReleaseMode.DAILY_ROLLOVER,
      })
    );
    expect(new Date(snipe.releaseAt!).toISOString()).toBe(PUBLIC_RELEASE);
    await until(() => snipeOf(snipe.id).status === SnipeStatus.ARMED);

    await ok(save(NUMBER));
    await until(() => snipeOf(snipe.id).releaseAt?.toISOString() === PRE_SALE);
    expect(snipeOf(snipe.id).status).toBe(SnipeStatus.ARMED);

    // Removing, with the snipe armed: never ACCOUNT_BUSY, and RAC's partition is left alone
    const removed = await remove();
    expect(removed).toMatchObject({ success: true, data: { status: 'signed-out' } });
    await until(() => snipeOf(snipe.id).releaseAt?.toISOString() === PUBLIC_RELEASE);
    expect(snipeOf(snipe.id).status).toBe(SnipeStatus.ARMED);
    expect(clear).not.toHaveBeenCalled();
    // A release compute sends nothing
    expect(http.requests).toEqual([]);
  });

  it('saved during the pre-sale: inside its window the snipe checks at once; after it, it stays armed for the public release', async () => {
    // Ten minutes into the members' pre-sale (its window is the snipe's, 15 minutes)
    start(new Date(Date.parse(PRE_SALE) + 10 * 60_000));
    container.scheduler.start();
    const create = (name: string) =>
      ok(
        call<SiteSnipe>('snipes:create', {
          providerId: 'rac',
          name,
          location: { externalId: 'busselton', name: 'RAC Busselton Holiday Park' },
          stay: HOLIDAYS,
          unitKinds: ['campsite'],
          releaseMode: SnipeReleaseMode.DAILY_ROLLOVER,
        })
      );
    const early = await create('Busselton, early');
    expect(new Date(early.releaseAt!).toISOString()).toBe(PUBLIC_RELEASE);
    await until(() => snipeOf(early.id).status === SnipeStatus.ARMED);

    await ok(save(NUMBER));
    await until(() => snipeOf(early.id).releaseAt?.toISOString() === PRE_SALE);
    // The pre-sale's window is open: it checks RAC at once (and finds the powered site)
    await until(() => http.requests.length > 0);
    await until(() => snipeOf(early.id).status === SnipeStatus.ALERTED);
    await ok(remove());

    // Twenty minutes in, the pre-sale's window has passed: armed for the public release
    jest.setSystemTime(new Date(Date.parse(PRE_SALE) + 20 * 60_000));
    const late = await create('Busselton, late');
    await until(() => snipeOf(late.id).status === SnipeStatus.ARMED);
    const sent = http.requests.length;
    await ok(save(NUMBER));
    // Re-armed: asked again, the public release stays, and nothing is sent
    await new Promise((r) => setTimeout(r, 100));
    expect(snipeOf(late.id)).toMatchObject({ status: SnipeStatus.ARMED });
    expect(snipeOf(late.id).releaseAt?.toISOString()).toBe(PUBLIC_RELEASE);
    expect(http.requests).toHaveLength(sent);
  });

  it('an unreadable number (data copied to another computer) counts as none: public prices, and Settings asks for it again', async () => {
    start();
    await sync();
    await ok(save(NUMBER));
    await expect(price()).resolves.toEqual({ total: 136, note: 'RAC member rate' });
    // Another computer's vault can't open the envelope
    container.db
      .prepare(
        "UPDATE provider_state SET value = ? WHERE provider_id = 'rac' AND key = 'secret:account.memberNumber'"
      )
      .run(JSON.stringify('vault:v1:local:bm90LWEtcmVhbC1lbnZlbG9wZQ=='));
    container.catalogService.forgetAvailability('rac');

    await expect(price()).resolves.toEqual({ total: 150, note: undefined });
    const account = (await ok(call<ProviderAccount[]>('accounts:list'))).find(
      (a) => a.providerId === 'rac'
    );
    expect(account).toMatchObject({ status: 'signed-out', savedFields: [] });
    const logs = logLines.join('\n');
    expect(logs).toContain("RAC: the saved member number can't be read");
    expect(logs).not.toContain(NUMBER);
  });
});
