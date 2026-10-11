/**
 * Live Electron test of the ParkStay module on `ElectronSessionHttpClient` (architecture-notes
 * §12.30): Chromium's network stack on the `persist:provider-parkstay` partition, against the
 * loopback ParkStay fixture server. It checks that the DBCA queue is recognised through the
 * production transport's real redirect handling (a 302 to the waiting room, followed hop by
 * hop, ends on the queue's page) as well as the 200 HTML redirect page, that requests carry
 * the browser headers ParkStay needs, and that the queue cookie lands in the partition on
 * `dbca.wa.gov.au`. Output is TAP; the exit code is the number of failures (capped at 1).
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, session } from 'electron';
import { createParkStayModules, parkstayManifest } from '../../src/main/providers/parkstay';
import { ProviderRegistry, type ProviderWith } from '../../src/main/providers/registry';
import {
  AccessGateError,
  CHROME_USER_AGENT,
  chromeUserAgent,
  runtimeChromeMajor,
  createProviderContext,
  defineProvider,
  FakeSecretVault,
  InMemoryKeyValueStore,
  ProviderParseError,
  type ProviderLogger,
} from '../../src/main/providers/sdk';
import { ElectronSessionHttpClient } from '../../src/main/providers/sdk/http-electron';
import {
  parkStayFixture,
  startParkStayFixtureServer,
  type ParkStayFixtureServer,
} from '../utils/parkstay-fixture-server';

const WATCHDOG_MS = 120_000;
const STAY = { arrival: '2026-11-10', departure: '2026-11-12', adults: 1 };

// A throwaway profile, so the persistent partition starts empty and is removed afterwards.
const userData = mkdtempSync(join(tmpdir(), 'wa-stay-parkstay-electron-'));
app.setPath('userData', userData);
app.disableHardwareAcceleration();

const quietLogger: ProviderLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quietLogger,
};

type ParkStay = ProviderWith<'snipes'> & ProviderWith<'accessGate'>;

function buildParkStay(server: ParkStayFixtureServer): ParkStay {
  const ctx = createProviderContext(parkstayManifest, {
    createHttp: (providerId) => new ElectronSessionHttpClient({ providerId }),
    createState: () => new InMemoryKeyValueStore(),
    vault: new FakeSecretVault(),
    logger: quietLogger,
    providersDir: join(userData, 'providers'),
    clock: () => new Date('2026-10-02T02:00:00.000Z'),
  });
  const factory = defineProvider(parkstayManifest, (c) =>
    createParkStayModules(c, { endpoints: server.endpoints })
  );
  return new ProviderRegistry().register(factory, ctx) as ParkStay;
}

async function rejection(pending: Promise<unknown>): Promise<unknown> {
  return pending.then(
    () => assert.fail('expected a rejection'),
    (error: unknown) => error
  );
}

interface Case {
  name: string;
  run(server: ParkStayFixtureServer, parkstay: ParkStay): Promise<void>;
}

const CASES: Case[] = [
  {
    name: 'checks availability with ParkStay dates, the Chrome user agent and the ParkStay Referer',
    async run(server, parkstay) {
      const result = await parkstay.availability.check('20', STAY);
      assert.equal(result.units.length, 5);
      assert.deepEqual(
        result.units.filter((u) => u.fullyAvailable).map((u) => [u.unitId, u.total]),
        [
          ['3', 60],
          ['4', 60],
          ['5', 60],
        ]
      );
      const [request] = server.requestsTo('/api/campsite_availablity_view/20/');
      assert.equal(request.query.get('arrival'), '2026/11/10');
      assert.equal(request.query.get('departure'), '2026/11/12');
      // The partition presents the Chromium version Electron runs (architecture-notes §12.32)
      assert.equal(request.headers['user-agent'], chromeUserAgent(runtimeChromeMajor()));
      assert.notEqual(request.headers['user-agent'], CHROME_USER_AGENT);
      assert.equal(request.headers.referer, 'https://parkstay.dbca.wa.gov.au/');
    },
  },
  {
    name: 'a 302 to the DBCA waiting room, followed by Chromium hop by hop, is AccessGateError (waiting)',
    async run(server, parkstay) {
      server.queueGate = 'redirect';
      const error = await rejection(parkstay.availability.check('20', STAY));
      assert.ok(error instanceof AccessGateError, String(error));
      assert.equal((error as AccessGateError).state, 'waiting');
      // The redirect really was followed to the waiting room (the final URL).
      assert.equal(server.requestsTo('/site-queue/waiting-room/').length, 1);
    },
  },
  {
    name: 'the 200 text/html queue page on an /api/ call is AccessGateError (waiting), not a parse error',
    async run(server, parkstay) {
      server.queueGate = 'html';
      for (const pending of [
        parkstay.catalog?.listLocations?.(),
        parkstay.availability.search!(STAY),
        parkstay.holds.create({ externalId: '20', unitId: '3', stay: STAY }),
      ]) {
        const error = await rejection(pending as Promise<unknown>);
        assert.ok(error instanceof AccessGateError, String(error));
        assert.ok(!(error instanceof ProviderParseError));
      }
    },
  },
  {
    name: 'places a hold with a form POST carrying ParkStay dates',
    async run(server, parkstay) {
      const hold = await parkstay.holds.create({ externalId: '20', unitId: '3', stay: STAY });
      assert.equal(hold.ok, true);
      const [post] = server.requestsTo('/api/create_booking');
      const form = new URLSearchParams(post.body);
      assert.deepEqual(
        [form.get('arrival'), form.get('departure'), form.get('campsite')],
        ['2026/11/10', '2026/11/12', '3']
      );
      assert.match(String(post.headers['content-type']), /application\/x-www-form-urlencoded/);
      assert.equal(post.headers.referer, 'https://parkstay.dbca.wa.gov.au/');
    },
  },
  {
    name: 'the queue gate keeps its sitequeuesession cookie in the partition, on dbca.wa.gov.au',
    async run(server, parkstay) {
      const active = parkStayFixture('queue-active.json');
      server.queueAnswers = [{ status: 200, body: active }];
      const status = await parkstay.access.ensure();
      assert.equal(status.state, 'active');
      assert.ok(!JSON.stringify(status).includes(active.session_key));
      const cookies = await session
        .fromPartition('persist:provider-parkstay')
        .cookies.get({ name: 'sitequeuesession' });
      assert.equal(cookies.length, 1);
      assert.equal(cookies[0].value, active.session_key);
      assert.equal(cookies[0].domain?.replace(/^\./, ''), 'dbca.wa.gov.au');
      const [request] = server.requestsTo('/api/check-create-session/');
      assert.equal(request.query.get('queue_group'), 'parkstayv2');
      assert.equal(request.headers.origin, 'https://parkstay.dbca.wa.gov.au');
    },
  },
];

async function main(): Promise<number> {
  let failures = 0;
  console.log('TAP version 13');
  console.log(`1..${CASES.length}`);

  for (const [index, testCase] of CASES.entries()) {
    const server = await startParkStayFixtureServer();
    const parkstay = buildParkStay(server);
    await session.fromPartition('persist:provider-parkstay').clearStorageData();
    const started = Date.now();
    try {
      await testCase.run(server, parkstay);
      console.log(`ok ${index + 1} - ${testCase.name} # ${Date.now() - started} ms`);
    } catch (error) {
      failures++;
      console.log(`not ok ${index + 1} - ${testCase.name}`);
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      for (const line of detail.split('\n')) console.log(`  # ${line}`);
    } finally {
      parkstay.access.dispose();
      await server.close();
    }
  }

  console.log(`# electron ${process.versions.electron}, chrome ${process.versions.chrome}`);
  console.log(`# ${CASES.length - failures} passed, ${failures} failed`);
  return failures;
}

const watchdog = setTimeout(() => {
  console.log('Bail out! the ParkStay Electron tests did not finish in time');
  app.exit(1);
}, WATCHDOG_MS);

app
  .whenReady()
  .then(main)
  .catch((error: unknown) => {
    console.log(`Bail out! ${error instanceof Error ? error.stack : String(error)}`);
    return 1;
  })
  .then((failures) => {
    clearTimeout(watchdog);
    try {
      rmSync(userData, { recursive: true, force: true });
    } catch {
      // A leftover temp folder is harmless.
    }
    app.exit(failures ? 1 : 0);
  });
