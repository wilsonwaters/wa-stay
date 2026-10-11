/**
 * Paying for a hold in the app (`HoldPaymentService`; architecture-notes §12.31, §12.32)
 * through P3's harness: a real container and database, the built-in ParkStay provider, and
 * provider windows on the mocked `electron` (`FakeBrowserWindow`). Holds are seeded rows
 * (never a live hold, §12.33); "pages" are `did-navigate` events on the fake window.
 *
 * - `snipes.openPayment` / `watches.openPayment` pass ParkStay's queue first (60 s bound), then
 *   open ParkStay's `/booking/` in a payment window on the partition the provider's HTTP
 *   client uses (where the hold is), and answer once the first page shows; a first page sent
 *   off the allow-list is `PROVIDER_ERROR`; after the DBCA waiting room the window goes back
 *   to `/booking/`;
 * - preconditions: `NOT_FOUND`, `CAPABILITY`, `HOLD_EXPIRED` (lapsed, expired, not held);
 * - one payment window per provider: the same hold focuses it, another is `VALIDATION`;
 * - `/success/` with the hold's `checkouthash`, showing "Your booking PB<ref> is completed",
 *   marks the snipe BOOKED (`PB` + reference, also from EXPIRED) or the watch booked, records
 *   one confirmed ParkStay booking (its unit by name: a site's or a class's, from the watch's
 *   last check or the place's cached units, never ParkStay's id), and emits
 *   `snipe:updated`/`watch:updated` then
 *   `booking:updated`; a reload changes nothing; another hold's `/success/`, DBCA's
 *   `success-error.html` at the right URL, or an error status is ignored;
 * - the window allows DBCA's hosts and ParkStay's sign-in origins, and keeps other hosts out
 *   (logged, not opened externally);
 * - closing it checks the ParkStay account once.
 */

import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { openDatabase } from '@main/database/connection';
import { createContainer, AppContainer } from '@main/app/container';
import { registerIpcHandlers } from '@main/ipc';
import type { ElectronSessionHttpClient } from '@main/providers/sdk/http-electron';
import { BookingStatus, SnipeStatus, WatchResult } from '@shared/types/common.types';
import type { APIResponse, Booking, Notification } from '@shared/types';
import type { LocationSummary, UnitSummary } from '@shared/types/catalog.types';
import { createMockSiteSnipeInput } from '@tests/fixtures/site-sniper';
import { createMockWatchInput } from '@tests/fixtures/watches';
import type { FakeBrowserWindow } from '@tests/utils/electron-mocks';
import { containerSecrets } from '@tests/utils/fake-safe-storage';
import { createFakeProvider, createTestProviderContext } from '@tests/utils/fake-provider';
import {
  FakeIpcMain,
  fakeEvent,
  fakeWebContents,
  type FakeWebContents,
  TEST_LOGS_DIR,
  TRUSTED_SENDER_ID,
} from '@tests/utils/ipc-harness';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

const electron = jest.requireMock('electron') as {
  BrowserWindow: typeof FakeBrowserWindow;
  shell: { openExternal: jest.Mock };
};
const { autoUpdater } = jest.requireMock('electron-updater') as { autoUpdater: EventEmitter };

const SITE = 'https://parkstay.dbca.wa.gov.au';
const MINUTE = 60_000;
const DAY = 86_400_000;
const SNIPE_HOLD = '2072968';
const WATCH_HOLD = '2072970';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const successUrl = (reference: string) => `${SITE}/success/?checkouthash=${sha256(reference)}`;
/** A calendar date `days` from now. */
const dateIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
/** Lets pending promise callbacks run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('hold payment over IPC', () => {
  let container: AppContainer;
  let ipc: FakeIpcMain;
  let renderer: FakeWebContents;
  let isSignedIn: jest.SpyInstance;
  let userId: number;

  const call = <T = unknown>(channel: string, payload?: unknown): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;
  const windows = () => electron.BrowserWindow.instances;
  const lastWindow = () => windows()[windows().length - 1];
  const sentNames = () => renderer.sent.map(([name]) => name);
  const snipes = () => container.repositories.snipes;
  const watches = () => container.repositories.watches;
  const bookings = () => container.repositories.bookings.findByUserId(userId);
  let gateEnsure: jest.SpyInstance;

  /**
   * Opens payment for a hold and, once its window exists, shows the first page as Chromium
   * would (the page commits); resolves with the IPC answer.
   */
  async function pay(channel: string, id: number, firstPage = `${SITE}/booking/`) {
    const before = windows().length;
    const answer = call(channel, { id });
    for (let turn = 0; turn < 100 && windows().length === before; turn++) await settle();
    if (windows().length > before) lastWindow().webContents.showPage(firstPage);
    return answer;
  }

  /** ParkStay's confirmation page for `reference`: its URL, and what `success.html` shows. */
  async function confirmation(
    reference: string,
    text = `Your booking PB${reference} is completed`
  ) {
    lastWindow().webContents.showPage(successUrl(reference), { text });
    for (let turn = 0; turn < 5; turn++) await settle();
  }

  /**
   * A ParkStay snipe at Osprey Bay (34) holding `unitId` (site 136 by default) until
   * `expiresAt` (a seeded row: no live hold).
   */
  function heldSnipe(
    reference = SNIPE_HOLD,
    expiresAt = new Date(Date.now() + 20 * MINUTE),
    unitId = '136'
  ) {
    const snipe = snipes().create(
      userId,
      createMockSiteSnipeInput({
        stay: { arrival: dateIn(40), departure: dateIn(42), adults: 2 },
      })
    );
    snipes().markHeld(snipe.id, reference, expiresAt, `${SITE}/booking/`, unitId);
    return snipes().findById(snipe.id)!;
  }

  /** Caches Osprey Bay's (34) detail in the catalogue with these units, as catalog.get does. */
  function cacheOspreyUnits(units: UnitSummary[]) {
    const place: LocationSummary = {
      key: 'parkstay:34',
      providerId: 'parkstay',
      externalId: '34',
      name: 'Osprey Bay',
      kind: 'campground',
      bookingMode: 'online',
      lat: -22.2,
      lng: 113.8,
      imageUrls: [],
      amenities: [],
    };
    const locations = container.repositories.locations;
    locations.upsertMany('parkstay', [place], new Date());
    expect(locations.setDetail('parkstay', '34', { ...place, units }, new Date())).toBe(true);
  }

  /** A ParkStay watch whose auto-hold holds site 3 ("CAMPSITE 03" in its last check). */
  function heldWatch(reference = WATCH_HOLD, expiresAt = new Date(Date.now() + 20 * MINUTE)) {
    const watch = watches().create(
      userId,
      createMockWatchInput({
        providerId: 'parkstay',
        stay: { arrival: dateIn(50), departure: dateIn(53), adults: 2 },
      })
    );
    watches().recordRun(watch.id, {
      result: WatchResult.FOUND,
      found: true,
      checkedAt: new Date(),
      nextCheckAt: new Date(Date.now() + 60 * MINUTE),
      availability: [
        { unitId: '3', unitName: 'CAMPSITE 03', nights: [], fullyAvailable: true },
        { unitId: '4', unitName: 'CAMPSITE 04', nights: [], fullyAvailable: false },
      ],
    });
    watches().markHeld(watch.id, {
      reference,
      expiresAt,
      unitId: '3',
      paymentUrl: `${SITE}/booking/`,
    });
    return watches().findById(watch.id)!;
  }

  beforeEach(() => {
    electron.BrowserWindow.instances.length = 0;
    electron.shell.openExternal.mockClear();
    container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...containerSecrets(),
    });
    userId = container.profile.ensureLocalProfile();
    renderer = fakeWebContents(TRUSTED_SENDER_ID);
    container.trustedWebContents.register(renderer);
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
    isSignedIn = jest
      .spyOn(container.providers.get('parkstay').auth!, 'isSignedIn')
      .mockResolvedValue({ state: 'signed-out' });
    // The DBCA queue lets the payment through at once (no network in tests)
    const gate = container.providers.get('parkstay').access!;
    gateEnsure = jest.spyOn(gate, 'ensure').mockResolvedValue(gate.status());
  });

  afterEach(async () => {
    await container.dispose();
    autoUpdater.removeAllListeners();
  });

  describe('snipes.openPayment', () => {
    it("opens ParkStay's /booking/ in a payment window on the HttpClient's partition", async () => {
      const snipe = heldSnipe();
      await expect(pay('snipes:open-payment', snipe.id)).resolves.toEqual({
        success: true,
        data: undefined,
      });

      expect(windows()).toHaveLength(1);
      const window = lastWindow();
      expect(window.loadURL).toHaveBeenCalledWith(`${SITE}/booking/`);
      expect(window.options.title).toBe('ParkStay — Payment');
      expect(window.title).toBe('ParkStay — Payment · parkstay.dbca.wa.gov.au');
      const http = container.providers.httpOf('parkstay') as ElectronSessionHttpClient;
      expect(window.options.webPreferences).toMatchObject({
        partition: http.partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      });
      expect(http.partition).toBe('persist:provider-parkstay');
      // Opening changes nothing
      expect(snipes().findById(snipe.id)).toEqual(snipe);
    });

    it("passes ParkStay's queue first (at most 60 s), then opens the window with the DBCA waiting room", async () => {
      const gate = container.providers.get('parkstay').access!;
      let letThrough!: () => void;
      gateEnsure.mockImplementation(
        () => new Promise((resolve) => (letThrough = () => resolve(gate.status())))
      );
      const answer = call('snipes:open-payment', { id: heldSnipe().id });
      for (let turn = 0; turn < 5; turn++) await settle();

      expect(gateEnsure).toHaveBeenCalledWith(expect.objectContaining({ maxWaitMs: 60_000 }));
      expect(windows()).toHaveLength(0);
      letThrough();
      for (let turn = 0; turn < 5 && windows().length === 0; turn++) await settle();
      expect(windows()).toHaveLength(1);
      lastWindow().webContents.showPage(`${SITE}/booking/`);
      await expect(answer).resolves.toMatchObject({ success: true });
    });

    it('after the DBCA waiting room sends it to the home page, /booking/ loads again (once)', async () => {
      await pay('snipes:open-payment', heldSnipe().id);
      const page = lastWindow().webContents;

      page.showPage('https://queue.dbca.wa.gov.au/site-queue/waiting-room/parkstayv2/');
      page.showPage(`${SITE}/search-availability/information/`);
      expect(lastWindow().loadURL.mock.calls.map(([url]) => url)).toEqual([
        `${SITE}/booking/`,
        `${SITE}/booking/`,
      ]);
    });

    it('a first page sent off the allow-list: openPayment is PROVIDER_ERROR naming the origin only, the window is gone, the hold untouched', async () => {
      const snipe = heldSnipe();
      const answer = call('snipes:open-payment', { id: snipe.id });
      for (let turn = 0; turn < 100 && windows().length === 0; turn++) await settle();

      expect(lastWindow().webContents.willRedirect('https://evil.example/pay?ref=2072968')).toBe(
        true
      );
      await expect(answer).resolves.toEqual({
        success: false,
        code: 'PROVIDER_ERROR',
        error: "ParkStay's page sent the window to https://evil.example, which it does not allow",
      });
      expect(lastWindow().destroyed).toBe(true);
      expect(snipes().findById(snipe.id)?.status).toBe(SnipeStatus.HELD);
      // No account check for a window that never showed a page
      expect(isSignedIn).not.toHaveBeenCalled();
      await expect(pay('snipes:open-payment', snipe.id)).resolves.toMatchObject({ success: true });
    });

    it('a missing snipe is NOT_FOUND, a provider without holds CAPABILITY; no window opens', async () => {
      container.providers.register(
        createFakeProvider({ id: 'noholds', capabilities: { holds: false, snipes: false } })
          .factory,
        createTestProviderContext
      );
      const other = snipes().create(userId, createMockSiteSnipeInput({ providerId: 'noholds' }));

      await expect(call('snipes:open-payment', { id: 999 })).resolves.toMatchObject({
        success: false,
        code: 'NOT_FOUND',
      });
      await expect(call('snipes:open-payment', { id: other.id })).resolves.toMatchObject({
        success: false,
        code: 'CAPABILITY',
      });
      expect(windows()).toHaveLength(0);
    });

    it('an expired hold is HOLD_EXPIRED: lapsed, EXPIRED, or never held; no window opens', async () => {
      const lapsed = heldSnipe('1', new Date(Date.now() - MINUTE));
      const expired = heldSnipe('2');
      container.siteSniperService.expireHold(expired.id);
      const armed = snipes().create(userId, createMockSiteSnipeInput());

      for (const id of [lapsed.id, expired.id, armed.id]) {
        await expect(call('snipes:open-payment', { id })).resolves.toEqual({
          success: false,
          code: 'HOLD_EXPIRED',
          error: 'This hold has expired, so it can no longer be paid for',
        });
      }
      expect(windows()).toHaveLength(0);
    });

    it('/success/ with the hold’s checkouthash marks it BOOKED (PB + reference), records one booking, and emits snipe:updated then booking:updated', async () => {
      cacheOspreyUnits([{ unitId: '136', unitName: 'CAMPSITE 07' }]);
      const snipe = heldSnipe();
      await pay('snipes:open-payment', snipe.id);
      renderer.sent.length = 0;

      await confirmation(SNIPE_HOLD);

      expect(snipes().findById(snipe.id)).toMatchObject({
        status: SnipeStatus.BOOKED,
        bookedReference: 'PB2072968',
        isActive: false,
      });
      expect(bookings()).toEqual([
        expect.objectContaining({
          providerId: 'parkstay',
          bookingReference: 'PB2072968',
          status: BookingStatus.CONFIRMED,
          location: { externalId: '34', name: 'Osprey Bay' },
          stay: expect.objectContaining({ arrival: dateIn(40), departure: dateIn(42) }),
          // The site's name, not ParkStay's global campsite id 136
          unitIds: ['CAMPSITE 07'],
          stayParams: snipe.stayParams,
        }),
      ]);
      expect(sentNames()).toEqual(['snipe:updated', 'booking:updated', 'notification:created']);
      expect(renderer.sent.find(([n]) => n === 'snipe:updated')?.[1]).toMatchObject({
        id: snipe.id,
        status: SnipeStatus.BOOKED,
      });
      expect(renderer.sent.find(([n]) => n === 'booking:updated')?.[1]).toMatchObject({
        bookingReference: 'PB2072968',
        manageUrl: expect.stringMatching(/^https:\/\/parkstay\.dbca\.wa\.gov\.au\//),
      });
      const notifications = await call<Notification[]>('notifications:list', {});
      expect(notifications.data).toEqual([
        expect.objectContaining({ type: 'snipe_booked', relatedId: snipe.id }),
      ]);
      // The window stays on ParkStay's confirmation page until the person closes it
      expect(lastWindow().close).not.toHaveBeenCalled();

      // A reload of the confirmation page changes nothing
      renderer.sent.length = 0;
      await confirmation(SNIPE_HOLD);
      expect(bookings()).toHaveLength(1);
      expect(sentNames()).toEqual([]);
    });

    it('a class hold records the class name; a hold nothing names records no unit', async () => {
      cacheOspreyUnits([{ unitId: 'class:117', unitName: 'One site - select on arrival' }]);
      const classHold = heldSnipe(SNIPE_HOLD, undefined, 'class:117');
      await pay('snipes:open-payment', classHold.id);
      await confirmation(SNIPE_HOLD);
      lastWindow().close();

      const unnamed = heldSnipe('2072999', undefined, '9999');
      await pay('snipes:open-payment', unnamed.id);
      await confirmation('2072999');

      const byRef = Object.fromEntries(bookings().map((b) => [b.bookingReference, b.unitIds]));
      expect(byRef).toEqual({
        PB2072968: ['One site - select on arrival'],
        PB2072999: [],
      });
    });

    it('success after the hold timer expired the snipe still books it (the confirmation page indicates payment)', async () => {
      const snipe = heldSnipe();
      await pay('snipes:open-payment', snipe.id);
      container.siteSniperService.expireHold(snipe.id);
      expect(snipes().findById(snipe.id)?.status).toBe(SnipeStatus.EXPIRED);

      await confirmation(SNIPE_HOLD);

      expect(snipes().findById(snipe.id)).toMatchObject({
        status: SnipeStatus.BOOKED,
        bookedReference: 'PB2072968',
      });
      expect(bookings().map((b) => b.bookingReference)).toEqual(['PB2072968']);
    });

    it("another hold's /success/, success-error.html, an earlier booking's page, an error status or another page records nothing", async () => {
      const snipe = heldSnipe();
      await pay('snipes:open-payment', snipe.id);
      const page = lastWindow().webContents;

      page.showPage(successUrl('1234567'), { text: 'Your booking PB1234567 is completed' });
      page.showPage(successUrl(SNIPE_HOLD), { status: 500, text: 'Your booking PB2072968' });
      page.showPage(`${SITE}/success/`);
      page.showPage(`${SITE}/booking/?checkouthash=${sha256(SNIPE_HOLD)}`);
      // DBCA's success-error.html, 200 at the right URL: the session's hash differed
      page.showPage(successUrl(SNIPE_HOLD), { text: 'Your booking session has expired.' });
      // The ps_last_booking fallback: an earlier booking's confirmation at the right URL
      page.showPage(successUrl(SNIPE_HOLD), { text: 'Your booking PB2070000 is completed' });
      for (let turn = 0; turn < 10; turn++) await settle();

      expect(snipes().findById(snipe.id)?.status).toBe(SnipeStatus.HELD);
      expect(bookings()).toEqual([]);
    });

    it('one payment window per provider: the same hold focuses it; another hold is VALIDATION', async () => {
      const snipe = heldSnipe();
      const other = heldSnipe('2072969');
      const watch = heldWatch();
      await pay('snipes:open-payment', snipe.id);
      const window = lastWindow();

      await expect(call('snipes:open-payment', { id: snipe.id })).resolves.toMatchObject({
        success: true,
      });
      expect(window.focus).toHaveBeenCalledTimes(1);
      for (const [channel, id] of [
        ['snipes:open-payment', other.id],
        ['watches:open-payment', watch.id],
      ] as const) {
        await expect(call(channel, { id })).resolves.toEqual({
          success: false,
          code: 'VALIDATION',
          error: 'Finish or close the open payment window first',
        });
      }
      expect(window.focus).toHaveBeenCalledTimes(3);
      expect(windows()).toHaveLength(1);

      // Closed before paying: nothing changed, and payment opens again
      window.close();
      await settle();
      expect(snipes().findById(snipe.id)?.status).toBe(SnipeStatus.HELD);
      await expect(pay('snipes:open-payment', other.id)).resolves.toMatchObject({
        success: true,
      });
      expect(windows()).toHaveLength(2);
    });

    it("allows DBCA's hosts and ParkStay's sign-in origins at the top level, and keeps any other host out without opening it", async () => {
      await pay('snipes:open-payment', heldSnipe().id);
      const page = lastWindow().webContents;

      expect(page.willNavigate('https://ledger.dbca.wa.gov.au/ledger/checkout')).toBe(false);
      expect(page.willNavigate('https://dbcab2c.b2clogin.com/oauth2/authorize')).toBe(false);
      expect(page.willNavigate(`${SITE}/ssologin`)).toBe(false);
      expect(page.willNavigate('https://evil.example/pay')).toBe(true);
      expect(page.willRedirect('https://evil.example/pay')).toBe(true);
      await settle();
      // Logged by host only, never sent to the browser (a payment page's own navigation)
      expect(electron.shell.openExternal).not.toHaveBeenCalled();
      // A new window (a receipt or a help link) is never opened in the app
      expect(page.windowOpenHandler?.({ url: 'https://evil.example/help' })).toEqual({
        action: 'deny',
      });
    });

    it('closing the payment window checks the ParkStay account once (the person may have signed in)', async () => {
      await pay('snipes:open-payment', heldSnipe().id);
      expect(isSignedIn).not.toHaveBeenCalled();
      isSignedIn.mockResolvedValue({ state: 'signed-in', email: 'a@b.au' });

      lastWindow().close();
      await settle();
      await settle();

      expect(isSignedIn).toHaveBeenCalledTimes(1);
      expect(container.accounts.storedState('parkstay')).toBe('signed-in');
      expect(sentNames()).toContain('account:updated');
    });
  });

  describe('watches.openPayment', () => {
    it('opens the same partitioned /booking/ window for a watch hold', async () => {
      const watch = heldWatch();
      await expect(pay('watches:open-payment', watch.id)).resolves.toEqual({
        success: true,
        data: undefined,
      });
      expect(lastWindow().loadURL).toHaveBeenCalledWith(`${SITE}/booking/`);
      expect(lastWindow().options.webPreferences).toMatchObject({
        partition: 'persist:provider-parkstay',
      });
    });

    it('an expired or missing watch hold is HOLD_EXPIRED, a missing watch NOT_FOUND', async () => {
      const lapsed = heldWatch('1', new Date(Date.now() - MINUTE));
      const unheld = watches().create(userId, createMockWatchInput({ providerId: 'parkstay' }));

      for (const id of [lapsed.id, unheld.id]) {
        await expect(call('watches:open-payment', { id })).resolves.toMatchObject({
          success: false,
          code: 'HOLD_EXPIRED',
        });
      }
      await expect(call('watches:open-payment', { id: 999 })).resolves.toMatchObject({
        success: false,
        code: 'NOT_FOUND',
      });
      expect(windows()).toHaveLength(0);
    });

    it('success turns the watch hold into a confirmed booking and emits watch:updated and booking:updated', async () => {
      const watch = heldWatch();
      await pay('watches:open-payment', watch.id);
      renderer.sent.length = 0;

      await confirmation(WATCH_HOLD);

      const stored = watches().findById(watch.id)!;
      expect(stored).toMatchObject({ lastResult: WatchResult.BOOKED, isActive: false });
      // The hold stays on the row, for the record
      expect(stored.hold).toMatchObject({ reference: WATCH_HOLD, unitId: '3' });
      expect(bookings()).toEqual([
        expect.objectContaining({
          providerId: 'parkstay',
          bookingReference: 'PB2072970',
          status: BookingStatus.CONFIRMED,
          // Named from the watch's last check
          unitIds: ['CAMPSITE 03'],
          stay: expect.objectContaining({ arrival: dateIn(50), departure: dateIn(53) }),
        }),
      ]);
      expect(sentNames()).toEqual(['watch:updated', 'booking:updated', 'notification:created']);
      const notifications = await call<Notification[]>('notifications:list', {});
      expect(notifications.data).toEqual([
        expect.objectContaining({ type: 'booking_confirmed', relatedId: bookings()[0].id }),
      ]);

      // A booked watch is not activated again, and its nights stay taken
      await expect(call('watches:activate', { id: watch.id })).resolves.toMatchObject({
        success: false,
        code: 'VALIDATION',
      });
    });
  });

  it('bookings.list shows the paid booking with its manage link', async () => {
    const snipe = heldSnipe();
    await pay('snipes:open-payment', snipe.id);
    await confirmation(SNIPE_HOLD);

    const listed = await call<Booking[]>('bookings:list');
    expect(listed.data).toEqual([
      expect.objectContaining({ bookingReference: 'PB2072968', manageUrl: expect.any(String) }),
    ]);
  });
});
