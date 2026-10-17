/**
 * One count of what is free, everywhere: for every recorded RAC answer (each park for 6–8 Nov
 * 2026, and every other stay in `tests/fixtures/providers/rac/`), a real container in fixture
 * mode (unpaced, nothing sent anywhere) is asked through IPC as the renderer asks it, and the
 * renderer's own words are worked out from the answers:
 * - Explore: `catalog:availability`'s entry for the park, and its card ("51 spots free");
 * - the place page: `catalog:check-location`'s units, and the night grid's summary line ("51
 *   spots free for all 2 nights", never "of M": RAC gives no total of its sites);
 * - a watch: `watches:run-now`'s matches and its Check now toast, its alert and the alert's
 *   email, and the watch's card and night grid from `watches:get`.
 * Each says the same number: the sites free for the whole stay of every category free for it,
 * as RAC counts them (`stay_through_sites_available`), never one per category. Only the noun
 * differs, following the units each counts (a watch's found units, a place's kinds).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import type Mail from 'nodemailer/lib/mailer';
import { createContainer, type AppContainer } from '@main/app/container';
import { openDatabase } from '@main/database/connection';
import { registerIpcHandlers } from '@main/ipc';
import { RAC_PARKS, racFactory, racManifest } from '@main/providers/rac';
import {
  availabilityLabel,
  deriveAvailability,
} from '@renderer/features/explore/availability/deriveAvailability';
import { summariseAvailability, summaryLine } from '@renderer/components/nightGridModel';
import { placeNoun } from '@renderer/components/locationFormat';
import { resultSummary, runResultMessage } from '@renderer/features/watches/shared/resultSummary';
import { watchNoun } from '@renderer/features/watches/shared/watchState';
import { NotifierChannel } from '@shared/types/notifier.types';
import type {
  APIResponse,
  LocationAvailability,
  StayQuery,
  Watch,
  WatchExecutionResult,
} from '@shared/types';
import type { CatalogAvailabilityResult } from '@shared/types/catalog.types';
import { addDays, eachNight } from '@shared/utils/calendar-date';
import { sumFreeUnits } from '@shared/utils/free-units';
import { fakeDateOnly } from '@tests/utils/core-harness';
import { containerSecrets, removeUserData } from '@tests/utils/fake-safe-storage';
import {
  FakeIpcMain,
  fakeEvent,
  fakeWebContents,
  TEST_LOGS_DIR,
  TRUSTED_SENDER_ID,
} from '@tests/utils/ipc-harness';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));
const { autoUpdater } = jest.requireMock('electron-updater') as { autoUpdater: EventEmitter };
const mockSendMail = jest.fn(async (_options: Mail.Options) => ({ messageId: 'message-1' }));
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail, verify: jest.fn() })) },
}));

/** Holds `rac/manifest.json`, which routes every recorded answer by park and arrival. */
const FIXTURES_DIR = path.join(__dirname, '../fixtures/providers');
const RAC_FIXTURES = path.join(FIXTURES_DIR, 'rac');
/** 10 am in Perth, 17 Oct 2026: the day after the answers were recorded. */
const NOW = new Date('2026-10-17T02:00:00.000Z');

/** Every recorded answer, with its park and its stay (from its nights). */
const ANSWERS = fs
  .readdirSync(RAC_FIXTURES)
  .filter((file) => /^availability-.+\.json$/.test(file))
  .map((file) => {
    const json = JSON.parse(fs.readFileSync(path.join(RAC_FIXTURES, file), 'utf8')) as {
      data: Record<string, { sites_code: Record<string, number> }>;
    };
    const nights = [
      ...new Set(Object.values(json.data).flatMap((c) => Object.keys(c.sites_code))),
    ].sort();
    const park = RAC_PARKS.find((p) => file.startsWith(`availability-${p.slug}-`))!;
    const stay: StayQuery = {
      arrival: nights[0],
      departure: addDays(nights[nights.length - 1], 1),
      adults: 2,
    };
    return { file, park, stay };
  });

describe('RAC free counts agree: Explore, the place page, a watch, its alert and its email', () => {
  let container: AppContainer;
  let userDataDir: string;
  let dir: string;
  let ipc: FakeIpcMain;

  const call = async <T>(channel: string, payload?: unknown): Promise<T> => {
    const response = (await ipc.invoke(channel, fakeEvent(), payload)) as APIResponse<T>;
    if (!response.success) throw new Error(`${channel}: ${response.code} ${response.error}`);
    return response.data as T;
  };

  beforeEach(async () => {
    fakeDateOnly(NOW);
    mockSendMail.mockClear();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-rac-counts-'));
    const secrets = containerSecrets();
    userDataDir = secrets.userDataDir;
    container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...secrets,
      fixtureMode: { fixturesDir: FIXTURES_DIR, logFile: path.join(dir, 'unexpected.log') },
      providerFactories: [racFactory],
    });
    container.profile.ensureLocalProfile();
    container.trustedWebContents.register(fakeWebContents(TRUSTED_SENDER_ID));
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
    // RAC's catalogue is its seed (nothing sent), and alerts are emailed
    await call('catalog:refresh', {});
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
  });

  afterEach(async () => {
    await container.dispose();
    autoUpdater.removeAllListeners();
    removeUserData(userDataDir);
    fs.rmSync(dir, { recursive: true, force: true });
    jest.useRealTimers();
  });

  it('has a recorded answer for every park', () => {
    expect(new Set(ANSWERS.map((answer) => answer.park.slug))).toEqual(
      new Set(RAC_PARKS.map((park) => park.slug))
    );
  });

  /** What each screen and message says about `park` for `stay`, and the counts behind it. */
  async function everywhere(park: (typeof RAC_PARKS)[number], stay: StayQuery) {
    const key = `rac:${park.slug}`;
    const nights = eachNight(stay.arrival, stay.departure);
    const place = { kind: 'holiday-park' as const, unitKinds: park.unitKinds };

    // Explore
    const bulk = await call<CatalogAvailabilityResult>('catalog:availability', {
      stay,
      providerIds: ['rac'],
    });
    const entry = bulk.entries.find((e) => e.key === key);
    if (!entry) throw new Error(`Explore has no entry for ${key}`);
    const card = availabilityLabel(
      deriveAvailability(
        { bookingMode: 'online', ...place },
        { staySet: true, capabilities: racManifest.capabilities, status: 'success', entry }
      ),
      park.unitKinds,
      racManifest.shortName
    )?.card;

    // The place page
    const checked = await call<LocationAvailability>('catalog:check-location', { key, stay });
    const placeSummary = summariseAvailability(checked.units, nights);
    const placeLine = summaryLine(placeSummary, placeNoun(place, racManifest), 'RAC');

    // A watch for any stay type: Check now, its alert and email, its card and night grid
    const created = await call<Watch>('watches:create', {
      providerId: 'rac',
      name: `${park.name} · ${stay.arrival}`,
      location: { externalId: park.slug, name: park.name },
      stay,
    });
    mockSendMail.mockClear();
    const run = await call<WatchExecutionResult>('watches:run-now', { id: created.id });
    const watch = await call<Watch>('watches:get', { id: created.id });
    const noun = watchNoun(watch, racManifest);
    const alerts = container.db
      .prepare('SELECT title, message FROM notifications WHERE related_id = ? ORDER BY id')
      .all(created.id) as Array<{ title: string; message: string }>;
    const emails = mockSendMail.mock.calls.map(([mail]) => mail);

    return {
      counts: {
        explore: entry.availableUnits,
        placePage: placeSummary.freeUnits,
        watchRun: sumFreeUnits(run.matches.filter((match) => !match.partial)),
        watchPage: summariseAvailability(watch.lastAvailability ?? [], nights).freeUnits,
      },
      words: {
        card,
        placeLine,
        toast: runResultMessage(run, created, watchNoun(created, racManifest), racManifest),
        watchCard: resultSummary(watch, noun),
        watchLine: summaryLine(
          summariseAvailability(watch.lastAvailability ?? [], nights),
          noun,
          'RAC'
        ),
        alerts,
        emails: emails.map((mail) => ({ text: String(mail.text), html: String(mail.html) })),
      },
    };
  }

  it("Busselton, 6–8 Nov 2026: 51 sites free everywhere, the powered site's whole-stay count", async () => {
    const park = RAC_PARKS.find((p) => p.slug === 'busselton')!;
    const { counts, words } = await everywhere(park, {
      arrival: '2026-11-06',
      departure: '2026-11-08',
      adults: 2,
    });
    expect(counts).toEqual({ explore: 51, placePage: 51, watchRun: 51, watchPage: 51 });
    // Explore and the place page call Busselton's units spots (it has sites and cabins); a
    // watch, the sites it found
    expect(words.card).toBe('51 spots free');
    expect(words.placeLine).toBe('51 spots free for all 2 nights');
    expect(words.toast).toBe('51 sites available at RAC Busselton Holiday Park');
    expect(words.watchCard).toBe('51 sites available');
    expect(words.watchLine).toBe('51 sites free for all 2 nights');
    expect(words.alerts).toEqual([
      {
        title: 'Sites available at RAC Busselton Holiday Park',
        message: expect.stringMatching(
          /^Found 51 sites available at RAC Busselton Holiday Park for /
        ),
      },
    ]);
    expect(words.emails).toHaveLength(1);
    expect(words.emails[0].text).toContain(words.alerts[0].message);
    expect(words.emails[0].html).toContain(
      'Found 51 sites available at RAC Busselton Holiday Park'
    );
  });

  it.each(ANSWERS.map((answer) => [answer.file, answer] as const))(
    'every screen counts the same: %s',
    async (_, { park, stay }) => {
      const { counts, words } = await everywhere(park, stay);
      const free = counts.explore;
      expect(counts).toEqual({ explore: free, placePage: free, watchRun: free, watchPage: free });

      // No "of M" anywhere: RAC gives no total of its sites
      for (const line of [words.card, words.placeLine, words.watchLine]) {
        expect(line).not.toMatch(/\bof\b/);
      }
      if (free > 0) {
        expect(words.card).toMatch(new RegExp(`^${free} \\w+ free$`));
        expect(words.placeLine).toMatch(new RegExp(`^${free} \\w+ free for `));
        expect(words.watchLine).toMatch(new RegExp(`^${free} \\w+ free for `));
        expect(words.watchCard).toMatch(new RegExp(`^${free} \\w+ available$`));
        expect(words.toast).toMatch(new RegExp(`^${free} \\w+ available at ${park.name}$`));
        expect(words.alerts).toHaveLength(1);
        expect(words.alerts[0].message).toMatch(
          new RegExp(`^Found ${free} \\w+ available at ${park.name} for `)
        );
        expect(words.emails).toHaveLength(1);
        expect(words.emails[0].text).toContain(words.alerts[0].message);
      } else {
        // Nothing free for the whole stay: no alert, and nothing reads as a count of one
        expect(words.alerts).toEqual([]);
        expect(words.emails).toEqual([]);
        expect(words.watchCard).toBe('Nothing yet');
        expect(words.toast).toBe('Nothing available yet');
      }
    }
  );
});
