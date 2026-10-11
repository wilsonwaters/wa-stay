/**
 * Live Electron test of `ElectronSessionHttpClient` (architecture-notes §12.30). This file is
 * Electron's main script: `tests/electron/run.js` bundles it and launches Electron with it.
 * It runs the shared transport cases (the same ones Jest runs against `NodeHttpClient`)
 * through Chromium's real network stack on a `persist:provider-<id>` partition, against
 * loopback servers, then a few Electron-only checks. Output is TAP; the exit code is the
 * number of failures (capped at 1).
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, session } from 'electron';
import { ElectronSessionHttpClient } from '../../src/main/providers/sdk/http-electron';
import {
  HTTP_TRANSPORT_CASES,
  startTransportTestServers,
  type TransportCase,
  type TransportCaseContext,
} from '../utils/http-transport-cases';

const PROVIDER_ID = 'etest';
const WATCHDOG_MS = 120_000;

// A throwaway profile, so the persistent partition starts empty and is removed afterwards.
const userData = mkdtempSync(join(tmpdir(), 'wa-stay-electron-test-'));
app.setPath('userData', userData);
app.disableHardwareAcceleration();

const ELECTRON_CASES: readonly TransportCase[] = [
  {
    name: 'stores cookies in the provider partition, persist:provider-<id>',
    async run({ client, base }) {
      await client.request('GET', `${base}/start`);
      const stored = await session
        .fromPartition(`persist:provider-${PROVIDER_ID}`)
        .cookies.get({ url: base });
      assert.deepEqual(stored.map((c) => `${c.name}=${c.value}`).sort(), [
        'first=1=2',
        'second=b',
        'third=c',
      ]);
    },
  },
];

async function main(): Promise<number> {
  const servers = await startTransportTestServers();
  const cases = [...HTTP_TRANSPORT_CASES, ...ELECTRON_CASES];
  let failures = 0;
  console.log('TAP version 13');
  console.log(`1..${cases.length}`);

  for (const [index, testCase] of cases.entries()) {
    const client = new ElectronSessionHttpClient({ providerId: PROVIDER_ID });
    await client.cookies.clear();
    const ctx: TransportCaseContext = { ...servers, client, userAgent: client.userAgent };
    const started = Date.now();
    try {
      await testCase.run(ctx);
      console.log(`ok ${index + 1} - ${testCase.name} # ${Date.now() - started} ms`);
    } catch (error) {
      failures++;
      console.log(`not ok ${index + 1} - ${testCase.name}`);
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      for (const line of detail.split('\n')) console.log(`  # ${line}`);
    }
  }

  await servers.close();
  console.log(`# electron ${process.versions.electron}, chrome ${process.versions.chrome}`);
  console.log(`# ${cases.length - failures} passed, ${failures} failed`);
  return failures;
}

const watchdog = setTimeout(() => {
  console.log('Bail out! the Electron transport tests did not finish in time');
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
