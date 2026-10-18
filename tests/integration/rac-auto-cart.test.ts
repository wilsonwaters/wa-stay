/**
 * RAC's auto-cart in the core (R19), with the `autoCart` experiment on: the real WatchService,
 * SiteSniperService, NightGuard, NotificationService (its email rendered by the real SMTP
 * notifier, nodemailer mocked) and HoldPaymentService (in-memory windows) over the real RAC
 * module, on an in-memory database. RAC answers from the synthetic cart fixtures
 * (`tests/fixtures/providers/rac/cart/`, written from RAC's NewBook scripts): no cart is ever
 * opened, and every cart address carries the made-up token of 32 zeros.
 *
 * - An auto-hold watch ends HELD, paid on RAC's cart page; its notification and email carry no
 *   cart address (the email says the hold is on this computer, and gives the public link).
 * - A hold snipe ends HELD at its release.
 * - Terms rule 13 and RO8: a second overlapping hold (a watch, then a snipe, then another
 *   watch, with a member number saved) is refused by the night guard; one for other nights by
 *   RAC's one cart.
 * - Closing the payment window with no confirmation lets the hold go once, and so does "Let it
 *   go"; a cart the person paid (emptied) is `gone`, "look for RAC's confirmation email".
 * - `holds.create` and `holds.release` run at interactive priority inside a background poll.
 * - No page the window loads marks an RAC hold booked.
 * - Turning the experiment off while a cart hold is open is ACCOUNT_BUSY (R17), over IPC.
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import type Mail from 'nodemailer/lib/mailer';
import { createContainer, type AppContainer } from '@main/app/container';
import { BookingService } from '@main/core/bookings/booking.service';
import {
  HoldPaymentService,
  RELEASED_MESSAGE,
  RELEASED_ON_CLOSE_MESSAGE,
  holdGoneMessage,
} from '@main/core/holds/hold-payment.service';
import { NIGHT_CONFLICT_MESSAGE, NightGuard } from '@main/core/holds/night-guard';
import type { NotificationDispatcher } from '@main/core/notifications/notification-dispatcher';
import { NotificationService } from '@main/core/notifications/notification.service';
import { SmtpEmailNotifier } from '@main/core/notifications/notifiers/email-smtp.notifier';
import { blockedMessage, SiteSniperService } from '@main/core/snipes/snipe.service';
import { WatchService } from '@main/core/watches/watch.service';
import { openDatabase } from '@main/database/connection';
import {
  BookingRepository,
  NotificationRepository,
  ProviderStateRepository,
  SiteSniperRepository,
  WatchRepository,
} from '@main/database/repositories';
import { registerIpcHandlers } from '@main/ipc';
import { withExperiments } from '@main/providers/experiments';
import { parkstayFactory } from '@main/providers/parkstay';
import { createRacModules, racFactory, racManifest } from '@main/providers/rac';
import { RAC_AVAILABILITY_PATH } from '@main/providers/rac/availability';
import { RAC_ONE_CART_MESSAGE } from '@main/providers/rac/holds';
import { ProviderRegistry } from '@main/providers/registry';
import {
  defineProvider,
  InMemoryKeyValueStore,
  type HttpMethod,
  type HttpRequestOptions,
  type HttpResponse,
  type ProviderContext,
  type RequestPriority,
} from '@main/providers/sdk';
import { currentRequestPriority } from '@main/providers/sdk/pacing';
import { FixtureHttpClient, type FixtureRoute } from '@main/testing/fixture-http-client';
import type { APIResponse, NotificationMessage, SiteSnipeInput, WatchInput } from '@shared/types';
import { SnipeReleaseMode, SnipeStatus, WatchResult } from '@shared/types/common.types';
import { fakeDateOnly } from '@tests/utils/core-harness';
import { containerSecrets } from '@tests/utils/fake-safe-storage';
import {
  createMemoryLogger,
  createTestProviderContext,
  type MemoryLogger,
} from '@tests/utils/fake-provider';
import { FakeOpener } from '@tests/utils/fake-provider-windows';
import { FakeIpcMain, fakeEvent, TEST_LOGS_DIR } from '@tests/utils/ipc-harness';

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

const { autoUpdater } = jest.requireMock('electron-updater') as { autoUpdater: EventEmitter };

const RAC = 'https://parksandresorts.rac.com.au';
const CART_FIXTURES = path.join(__dirname, '../fixtures/providers/rac/cart');
const CART_PAGE = `${RAC}/busselton/booking/`;
const PROXY_PATH =
  '/busselton/wp-content/themes/parks-and-resorts/inc/newbook/api/rac-busselton-holiday-park.php';
const ZERO_TOKEN = '0'.repeat(32);
/** Anything that would be the cart address or its token. */
const CART_ADDRESS = /rest_api_data_id|0{32}|\?cart|cart&|rand=100/;
/** 10 am in Perth, 17 Oct 2026. */
const NOW = new Date('2026-10-17T02:00:00.000Z');
const MINUTE = 60_000;
const EQUIPMENT = { equipmentType: '1', equipmentLength: '6.5', equipmentWidth: '2.5' };
/** Made up (RS13): never a real member number. */
const MEMBER_NUMBER = '012345678';

interface Sent {
  method: HttpMethod;
  url: string;
  body?: string;
  priority: RequestPriority;
}

/** A FixtureHttpClient that records each request with the priority it ran at. */
class RecordingFixtureClient extends FixtureHttpClient {
  readonly sent: Sent[] = [];
  override async request(
    method: HttpMethod,
    url: string,
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse> {
    this.sent.push({
      method,
      url,
      ...(options.body === undefined ? {} : { body: String(options.body) }),
      priority: currentRequestPriority(),
    });
    return super.request(method, url, options);
  }
}

let dir: string;
let http: RecordingFixtureClient;
let db: Database.Database;
let registry: ProviderRegistry;
let watchRepo: WatchRepository;
let snipeRepo: SiteSniperRepository;
let notificationRepo: NotificationRepository;
let watches: WatchService;
let snipes: SiteSniperService;
let payments: HoldPaymentService;
let windows: FakeOpener;
let logger: MemoryLogger;
let dispatched: NotificationMessage[];
let member: boolean;
let racContext: ProviderContext;

const copy = (file: string, as = file) =>
  fs.copyFileSync(path.join(CART_FIXTURES, file), path.join(dir, 'rac', as));
/** What RAC's cart page shows now (the cart page with no query). */
const cartShows = (file: string) => copy(file, 'cart-now.html');

function writeRoutes(cartPageStatus?: number): void {
  const answer = fs.readFileSync(
    path.join(CART_FIXTURES, 'availability-busselton-2026-11-06-2n.json'),
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'rac', 'answer-6-nov.json'), answer);
  // The same answer for 10–12 Nov: other nights, for the one-cart rule
  fs.writeFileSync(
    path.join(dir, 'rac', 'answer-10-nov.json'),
    answer.replaceAll('2026-11-06', '2026-11-10').replaceAll('2026-11-07', '2026-11-11')
  );
  copy('cart-page-one-stay.html');
  copy('remove-item-from-cart.json');
  fs.copyFileSync(
    path.join(CART_FIXTURES, '..', 'blocked-429.html'),
    path.join(dir, 'rac', 'blocked.html')
  );
  cartShows('cart-page-empty.html');
  const routes: FixtureRoute[] = [
    ...['1001', '1002', '1003'].map((rand): FixtureRoute => ({
      method: 'GET',
      path: '/busselton/booking/',
      query: { rand },
      file: 'cart-page-one-stay.html',
    })),
    cartPageStatus
      ? { method: 'GET', path: '/busselton/booking/', status: cartPageStatus, file: 'blocked.html' }
      : { method: 'GET', path: '/busselton/booking/', file: 'cart-now.html' },
    ...(['6', '10'] as const).map((day): FixtureRoute => ({
      method: 'POST',
      path: RAC_AVAILABILITY_PATH,
      form: { blog_id: '6', available_from: `${day} Nov 2026` },
      file: `answer-${day}-nov.json`,
    })),
    {
      method: 'POST',
      path: PROXY_PATH,
      query: { newbook_api_action: 'data', query: 'remove_item_from_cart' },
      file: 'remove-item-from-cart.json',
    },
  ];
  fs.writeFileSync(path.join(dir, 'rac', 'manifest.json'), JSON.stringify({ routes }));
}

/** The services over RAC with auto-cart on, its member number saved or not (`member`). */
function setUp(cartPageStatus?: number): void {
  writeRoutes(cartPageStatus);
  http = new RecordingFixtureClient({
    providerId: 'rac',
    fixturesDir: dir,
    logFile: path.join(dir, 'unexpected.log'),
  });
  logger = createMemoryLogger();
  db = openDatabase(':memory:');
  registry = new ProviderRegistry();
  const factory = withExperiments(
    defineProvider(racManifest, (ctx) => createRacModules(ctx, { isMember: async () => member })),
    ['autoCart']
  );
  registry.register(factory, (manifest) => {
    racContext = createTestProviderContext(manifest, {
      http,
      state: new InMemoryKeyValueStore(),
      logger,
      clock: () => new Date(),
    });
    return racContext;
  });
  watchRepo = new WatchRepository(db);
  snipeRepo = new SiteSniperRepository(db);
  notificationRepo = new NotificationRepository(db);
  const nightGuard = new NightGuard(snipeRepo, watchRepo);
  const email = new SmtpEmailNotifier({
    providerName: (id) => registry.tryGet(id)?.manifest.shortName,
  });
  email.configure({
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: 'me@example.com', pass: 'app-password' },
  });
  dispatched = [];
  const dispatcher = {
    dispatch: async (message: NotificationMessage) => {
      dispatched.push(message);
      await email.send(message);
      return [];
    },
  } as unknown as NotificationDispatcher;
  const notifications = new NotificationService(notificationRepo, dispatcher, undefined, {
    providerName: (id) => registry.tryGet(id)?.manifest.shortName,
    providerManifest: (id) => registry.tryGet(id)?.manifest,
    preferences: () => ({ desktop: false, sound: false }),
  });
  const events = { emit: jest.fn() };
  watches = new WatchService({
    watches: watchRepo,
    providers: registry,
    notifications,
    nightGuard,
    events,
    random: () => 0,
  });
  snipes = new SiteSniperService({
    snipes: snipeRepo,
    providers: registry,
    notifications,
    nightGuard,
    events,
  });
  windows = new FakeOpener();
  payments = new HoldPaymentService({
    providers: registry,
    snipes: snipeRepo,
    watches: watchRepo,
    bookings: new BookingService({
      bookings: new BookingRepository(db),
      providers: registry,
      events,
    }),
    notifications: {
      notifySnipeBooked: jest.fn().mockResolvedValue(undefined),
      notifyBookingConfirmed: jest.fn().mockResolvedValue(undefined),
    },
    windows,
    events,
    transaction: (fn) => db.transaction(fn)(),
    logger,
    timings: { accessGateWaitMs: 5_000, firstPageWaitMs: 5_000 },
  });
}

function busseltonWatch(overrides: Partial<WatchInput> = {}): WatchInput {
  return {
    providerId: 'rac',
    name: 'Busselton, powered site',
    location: { externalId: 'busselton', name: 'RAC Busselton Holiday Park' },
    stay: { arrival: '2026-11-06', departure: '2026-11-08', adults: 2 },
    unitKinds: ['campsite'],
    checkIntervalMinutes: 15,
    autoHold: true,
    stayParams: EQUIPMENT,
    ...overrides,
  };
}

function busseltonSnipe(overrides: Partial<SiteSnipeInput> = {}): SiteSnipeInput {
  return {
    providerId: 'rac',
    name: 'Busselton snipe',
    location: { externalId: 'busselton', name: 'RAC Busselton Holiday Park' },
    stay: { arrival: '2026-11-06', departure: '2026-11-08', adults: 2 },
    unitKinds: ['campsite'],
    releaseMode: SnipeReleaseMode.SCHEDULED,
    releaseAt: new Date(NOW.getTime() + 60 * MINUTE),
    action: 'hold',
    stayParams: EQUIPMENT,
    ...overrides,
  };
}

/** A snipe at its release: created, then sniping (as the scheduler leaves it), then run. */
async function snipeAtRelease(overrides: Partial<SiteSnipeInput> = {}) {
  const snipe = await snipes.create(1, busseltonSnipe(overrides));
  snipes.setStatus(snipe.id, SnipeStatus.SNIPING);
  await snipes.execute(snipe.id);
  return snipeRepo.findById(snipe.id)!;
}

const holdsOf = () => registry.require('rac', 'holds').holds;
const cartRequests = () => http.sent.filter((r) => CART_ADDRESS.test(r.url));
/** Lets the payment service's close handling and the release run. */
async function drain(): Promise<void> {
  for (let turn = 0; turn < 50; turn++) await new Promise((resolve) => setTimeout(resolve, 1));
}

beforeEach(() => {
  fakeDateOnly(NOW);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-auto-cart-'));
  fs.mkdirSync(path.join(dir, 'rac'));
  member = false;
  mockSendMail.mockClear();
  setUp();
});

afterEach(() => {
  payments?.dispose();
  db?.close();
  jest.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('RAC auto-cart in the core (synthetic fixtures)', () => {
  it("an auto-hold watch ends HELD, paid on RAC's cart page; its notification and email carry no cart address", async () => {
    const watch = await watches.create(1, busseltonWatch());

    const result = await watches.execute(watch.id);

    expect(result.hold).toEqual({
      reference: expect.stringMatching(/^rac-cart:busselton:2026-11-06:[0-9a-f]+$/),
      expiresAt: new Date(NOW.getTime() + 15 * MINUTE).toISOString(),
      unitId: 'cat:4',
      paymentUrl: CART_PAGE,
    });
    expect(watchRepo.findById(watch.id)).toMatchObject({
      lastResult: WatchResult.HELD,
      isActive: false,
      hold: { unitId: 'cat:4', paymentUrl: CART_PAGE },
    });
    // The check, then the hold: the cart page, one POST and one GET of the cart address
    expect(http.sent.map((r) => `${r.method} ${r.url.replace(RAC, '')}`)).toEqual([
      `POST ${RAC_AVAILABILITY_PATH}`,
      'GET /busselton/booking/',
      `POST ${RAC_AVAILABILITY_PATH}`,
      `GET /busselton/booking/?cart&rest_api_data_id=${ZERO_TOKEN}&rand=1001`,
    ]);

    // The held notification and its email: the hold is on this computer, the public link
    const [notice] = notificationRepo.findByUserId(1);
    expect(notice).toMatchObject({ type: 'snipe_held', providerId: 'rac' });
    expect(JSON.stringify(notice)).not.toMatch(CART_ADDRESS);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ heldInApp: true });
    expect(dispatched[0].bookingUrl).toMatch(
      /^https:\/\/parksandresorts\.rac\.com\.au\/busselton\/booking\/\?available_from=/
    );
    expect(dispatched[0].bookingUrl).toContain('force_category_id=4');
    expect(JSON.stringify(dispatched)).not.toMatch(CART_ADDRESS);
    const [mail] = mockSendMail.mock.calls[0];
    expect(String(mail.text)).toContain('This hold is in WA Stay on the computer that placed it.');
    expect(JSON.stringify([mail.subject, mail.html, mail.text])).not.toMatch(CART_ADDRESS);
    // Never the cart page itself as a link either: only the public booking page
    expect(String(mail.html)).not.toContain(`href="${CART_PAGE}"`);
    expect(JSON.stringify(logger.lines)).not.toMatch(CART_ADDRESS);
  });

  it('a hold snipe ends HELD at its release', async () => {
    const snipe = await snipeAtRelease();
    expect(snipe).toMatchObject({
      status: SnipeStatus.HELD,
      action: 'hold',
      holdReference: expect.stringMatching(/^rac-cart:busselton:2026-11-06:/),
      holdExpiresAt: new Date(NOW.getTime() + 15 * MINUTE),
      holdUnitId: 'cat:4',
      paymentUrl: CART_PAGE,
    });
    expect(snipe.holdExpiresEstimated).not.toBe(true);
    expect(cartRequests()).toHaveLength(1);
    expect(JSON.stringify(notificationRepo.findByUserId(1))).not.toMatch(CART_ADDRESS);
  });

  it('terms rule 13 and RO8: with a member number, a second and a third overlapping hold are refused by the night guard; one for other nights by the one cart', async () => {
    member = true;
    const create = jest.spyOn(holdsOf(), 'create');
    const watch = await watches.create(1, busseltonWatch());
    await watches.execute(watch.id);
    expect(watchRepo.findById(watch.id)?.lastResult).toBe(WatchResult.HELD);
    // The member's rate: its own cart address
    expect(cartRequests().map((r) => new URL(r.url).searchParams.get('rand'))).toEqual(['1002']);
    expect(create).toHaveBeenCalledTimes(1);

    // A snipe for the same nights: refused before RAC is asked to hold
    const second = await snipeAtRelease();
    expect(second).toMatchObject({ status: SnipeStatus.FAILED, lastError: NIGHT_CONFLICT_MESSAGE });
    // A third, another watch for the same nights: refused the same way
    const third = await watches.create(1, busseltonWatch({ name: 'Busselton again' }));
    await watches.execute(third.id);
    expect(watchRepo.findById(third.id)).toMatchObject({
      lastResult: WatchResult.FOUND,
      lastError: `Not held automatically: ${NIGHT_CONFLICT_MESSAGE}`,
    });
    expect(create).toHaveBeenCalledTimes(1);

    // Other nights (10–12 Nov): RAC's one cart refuses, with no request of the hold's own
    const sentBefore = http.sent.length;
    const other = await snipeAtRelease({
      name: 'Other nights',
      stay: { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 },
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(other).toMatchObject({ status: SnipeStatus.SNIPING, lastError: RAC_ONE_CART_MESSAGE });
    // Only the snipe's own check was sent, and one cart address in all
    expect(http.sent.slice(sentBefore).map((r) => r.url)).toEqual([
      `${RAC}${RAC_AVAILABILITY_PATH}`,
    ]);
    expect(cartRequests()).toHaveLength(1);
    expect(JSON.stringify([http.sent, logger.lines])).not.toContain(MEMBER_NUMBER);
  });

  it('closing the payment window with no confirmation lets the hold go once: one GET and the removal, interactive', async () => {
    // A member: the window opens on the cart page with nothing of the number (the person
    // copies it with the Copy button and types it at RAC's checkout)
    member = true;
    await racContext.secrets.set('account.memberNumber', MEMBER_NUMBER);
    const release = jest.spyOn(holdsOf(), 'release');
    const watch = await watches.create(1, busseltonWatch());
    await watches.execute(watch.id);
    cartShows('cart-page-one-stay.html');

    await payments.openForWatch(watch.id);
    expect(windows.requests).toEqual([
      expect.objectContaining({ kind: 'payment', url: CART_PAGE, allowedOrigins: [RAC] }),
    ]);
    expect(JSON.stringify([windows.requests, windows.last.loads])).not.toContain(MEMBER_NUMBER);
    const sentBefore = http.sent.length;
    windows.last.close();
    await drain();

    expect(release).toHaveBeenCalledTimes(1);
    expect(http.sent.slice(sentBefore)).toEqual([
      expect.objectContaining({ method: 'GET', url: CART_PAGE, priority: 'interactive' }),
      expect.objectContaining({
        method: 'POST',
        url: `${RAC}${PROXY_PATH}?newbook_api_action=data&query=remove_item_from_cart`,
        body: 'item_offset=0&cart_type=booking',
        priority: 'interactive',
      }),
    ]);
    expect(JSON.stringify([http.sent, logger.lines])).not.toContain(MEMBER_NUMBER);
    expect(watchRepo.findById(watch.id)).toMatchObject({
      lastResult: WatchResult.HELD,
      lastError: RELEASED_ON_CLOSE_MESSAGE,
      hold: { expiresAt: NOW },
    });
  });

  it('"Let it go" lets a snipe\'s hold go once; a cart the person paid (emptied) is gone, pointing to RAC\'s confirmation email', async () => {
    const release = jest.spyOn(holdsOf(), 'release');
    const snipe = await snipeAtRelease();
    cartShows('cart-page-empty.html');

    const answer = await payments.releaseSnipeHold(snipe.id);

    expect(release).toHaveBeenCalledTimes(1);
    expect(answer).toMatchObject({
      status: SnipeStatus.EXPIRED,
      lastError: holdGoneMessage('RAC'),
    });
    expect(holdGoneMessage('RAC')).toBe(
      "RAC no longer holds it. If you paid, look for RAC's confirmation email."
    );
    // Only the cart page was read: nothing was taken out of a paid cart
    expect(http.sent.filter((r) => r.method === 'POST' && r.url.includes(PROXY_PATH))).toEqual([]);
  });

  it('"Let it go" on a watch whose cart still holds it: released', async () => {
    const watch = await watches.create(1, busseltonWatch());
    await watches.execute(watch.id);
    cartShows('cart-page-one-stay.html');
    const answer = await payments.releaseWatchHold(watch.id);
    expect(answer.lastError).toBe(RELEASED_MESSAGE);
    expect(http.sent.filter((r) => r.url.includes(PROXY_PATH))).toHaveLength(1);
  });

  it('RAC turns the hold away (429): a hold snipe ends FAILED and a watch says why, and nothing more is sent', async () => {
    db.close();
    payments.dispose();
    setUp(429);
    const snipe = await snipeAtRelease();
    expect(snipe).toMatchObject({
      status: SnipeStatus.FAILED,
      lastError: blockedMessage('RAC', 429),
    });
    // The check, then the cart page, which was turned away: no POST for the cart, no cart address
    expect(http.sent.map((r) => r.method)).toEqual(['POST', 'GET']);

    // In the cool-down a watch fails at once (its check is turned away too), says why, sends nothing
    const watch = await watches.create(1, busseltonWatch());
    const sent = http.sent.length;
    await watches.execute(watch.id);
    expect(watchRepo.findById(watch.id)?.lastError).toMatch(
      /^RAC Parks & Resorts turned the request away \(HTTP 429\)/
    );
    expect(http.sent.length).toBe(sent);
    expect(cartRequests()).toEqual([]);
  });

  it('holds.create runs at interactive priority inside a background poll; the poll stays background', async () => {
    const watch = await watches.create(1, busseltonWatch());
    await watches.execute(watch.id);
    expect(http.sent.map((r) => r.priority)).toEqual([
      'background',
      'interactive',
      'interactive',
      'interactive',
    ]);
    const snipeSent = http.sent.length;
    await snipeAtRelease({
      name: 'Other nights',
      stay: { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 },
    });
    // The snipe's poll: background (its hold was refused by the one cart, with no request)
    expect(http.sent.slice(snipeSent).map((r) => r.priority)).toEqual(['background']);
  });

  it('no page the payment window loads marks an RAC hold booked', async () => {
    const watch = await watches.create(1, busseltonWatch());
    await watches.execute(watch.id);
    const reference = watchRepo.findById(watch.id)!.hold!.reference;
    cartShows('cart-page-empty.html');

    await payments.openForWatch(watch.id);
    for (const page of [
      `${RAC}/busselton/booking/?cart=Booking`,
      `${RAC}/busselton/booking/success/`,
      `${RAC}/busselton/booking/?confirmation&booking_id=123456`,
    ]) {
      windows.last.showPage(page, {
        text: `Thank you. Your booking reference is 123456. ${reference} Booking confirmed`,
      });
    }
    await drain();

    expect(watchRepo.findById(watch.id)?.lastResult).toBe(WatchResult.HELD);
    expect(new BookingRepository(db).findByUserId(1)).toEqual([]);
    expect(holdsOf().bookedReference).toBeUndefined();
  });
});

describe('turning auto-cart off while a cart hold is open (R17)', () => {
  let container: AppContainer | undefined;

  afterEach(async () => {
    await container?.dispose();
    container = undefined;
    autoUpdater.removeAllListeners();
  });

  it('is ACCOUNT_BUSY while an RAC watch holds a cart, and allowed once the hold has ended', async () => {
    const file = path.join(dir, 'wa-stay.db');
    const stored = openDatabase(file);
    new ProviderStateRepository(stored).set('rac', 'core.experiments', { autoCart: true });
    stored.close();
    container = createContainer({
      db: openDatabase(file),
      logsDir: TEST_LOGS_DIR,
      ...containerSecrets(),
      providerFactories: [parkstayFactory, racFactory],
      fixtureMode: { fixturesDir: path.join(dir, 'none'), logFile: path.join(dir, 'u.log') },
    });
    const userId = container.profile.ensureLocalProfile();
    const ipc = new FakeIpcMain();
    registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
    const call = <T>(channel: string, payload?: unknown) =>
      ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;
    expect(container.providers.get('rac').manifest.capabilities.holds).toBe(true);
    expect(container.providers.get('rac').holds).toBeDefined();

    const repo = container.repositories.watches;
    const watch = repo.create(userId, busseltonWatch());
    repo.markHeld(watch.id, {
      reference: 'rac-cart:busselton:2026-11-06:0a1b2c',
      expiresAt: new Date(NOW.getTime() + 10 * MINUTE),
      expiresEstimated: true,
      unitId: 'cat:4',
      paymentUrl: CART_PAGE,
    });
    const off = { providerId: 'rac', experimentId: 'autoCart', enabled: false };

    await expect(call('providers:set-experiment', off)).resolves.toMatchObject({
      success: false,
      code: 'ACCOUNT_BUSY',
      error: 'A stay is held on RAC. Pay for it or let it go first.',
    });

    repo.endHold(watch.id, 'rac-cart:busselton:2026-11-06:0a1b2c', NOW, 'You let it go.');
    await expect(call('providers:set-experiment', off)).resolves.toMatchObject({
      success: true,
      data: [{ id: 'autoCart', enabled: false, active: true }],
    });
  });
});
