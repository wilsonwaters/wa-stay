/**
 * Test data written before a launch, by the app's own built code (`seed-db.js`, run with the
 * Electron binary as Node so better-sqlite3's Electron build loads). Network-free: nothing here
 * reaches a provider, and no hold is ever placed (architecture-notes §12.33).
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { REPO_ROOT } from './paths';

/** Outside Electron, the `electron` package resolves to the path of its binary. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- its types describe the Electron API
const ELECTRON_BINARY = require('electron') as unknown as string;
const SEED_SCRIPT = path.join(__dirname, 'seed-db.js');

/** The released v1.2.0 database (schema v5), as the migration tests use it. */
export const V5_DUMP = path.join(REPO_ROOT, 'tests', 'fixtures', 'db', 'v5-release-1.2.0.sql');
/** The v1.x database file name in its data folder (`app/paths.ts`). */
export const LEGACY_DATABASE_FILE = 'parkstay.db';

function runSeed<T>(job: Record<string, unknown>): T {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-e2e-seed-'));
  try {
    const jobFile = path.join(work, 'job.json');
    const out = path.join(work, 'result.json');
    fs.writeFileSync(jobFile, JSON.stringify({ ...job, out }));
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', LOG_LEVEL: 'warn' };
    for (const name of Object.keys(env)) if (name.startsWith('WA_STAY_')) delete env[name];
    try {
      execFileSync(ELECTRON_BINARY, [SEED_SCRIPT, jobFile], { cwd: REPO_ROOT, env, stdio: 'pipe' });
    } catch (error) {
      const failure = error as { stderr?: Buffer; message: string };
      throw new Error(
        `Seeding (${String(job.op)}) failed: ${failure.stderr?.toString() || failure.message}\n` +
          'If it says NODE_MODULE_VERSION, node_modules predates better-sqlite3 13: run `npm ci`.',
        { cause: error }
      );
    }
    return JSON.parse(fs.readFileSync(out, 'utf8')) as T;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** A v1.2.0 install's data folder in `dir`: its `parkstay.db` from the v5 fixture. */
export function writeLegacyV1Data(dir: string): string {
  const file = path.join(dir, LEGACY_DATABASE_FILE);
  runSeed({ op: 'legacy-v5', file, dump: V5_DUMP });
  return file;
}

export interface HeldSnipeSeed {
  snipe: {
    name: string;
    location: { externalId: string; name: string; areaName?: string };
    stay: { arrival: string; departure: string; adults: number };
  };
  hold: {
    /** A made-up reference: it never reaches ParkStay. */
    reference: string;
    expiresAt: Date;
    /** The held unit: a site id, or a site class (`class:<id>`). */
    unitId: string;
  };
  /** Also add the `snipe_held` notification for it, with this title and message. */
  notification?: { title: string; message: string };
}

/**
 * A ParkStay snipe that holds a site (status HELD, inactive), in the profile at `userDataDir`
 * (its database is created and migrated if new), and optionally its `snipe_held` notification
 * linking to it.
 */
export function seedHeldSnipe(
  userDataDir: string,
  seed: HeldSnipeSeed
): { snipeId: number; notificationId: number | null } {
  return runSeed({
    op: 'held-snipe',
    dbPath: path.join(userDataDir, 'wa-stay.db'),
    snipe: { providerId: 'parkstay', releaseMode: 'cancellation', ...seed.snipe },
    hold: { ...seed.hold, expiresAt: seed.hold.expiresAt.toISOString() },
    notification: seed.notification && {
      providerId: 'parkstay',
      type: 'snipe_held',
      ...seed.notification,
    },
  });
}

export interface AlertSnipeSeed {
  snipe: {
    name: string;
    location: { externalId: string; name: string; areaName?: string };
    stay: { arrival: string; departure: string; adults: number };
  };
}

/**
 * A ParkStay snipe that alerts (`action: 'alert'`), armed and watching for cancellations, in the
 * profile at `userDataDir` (its database is created and migrated if new). Only the snipe row is
 * written: once the app starts, its scheduler checks the place at once and, when the fixtures
 * have the stay free, the app itself records the alert and sends its `snipe_alert`
 * notification. Nothing is ever held (architecture-notes §12.33).
 */
export function seedAlertSnipe(userDataDir: string, seed: AlertSnipeSeed): { snipeId: number } {
  return runSeed({
    op: 'alert-snipe',
    dbPath: path.join(userDataDir, 'wa-stay.db'),
    snipe: { providerId: 'parkstay', releaseMode: 'cancellation', action: 'alert', ...seed.snipe },
  });
}

export interface HeldWatchSeed {
  watch: {
    providerId: string;
    name: string;
    location: { externalId: string; name: string; areaName?: string };
    stay: { arrival: string; departure: string; adults: number };
    unitKinds?: string[];
    checkIntervalMinutes: number;
    autoHold: true;
    stayParams?: Record<string, string | number | boolean>;
  };
  hold: {
    /** A made-up reference: it never reaches the provider, and no cart or hold is created. */
    reference: string;
    expiresAt: Date;
    expiresEstimated?: boolean;
    unitId: string;
    paymentUrl: string;
  };
  /** The provider's experiment choices, stored before launch (`{ autoCart: true }`). */
  experiments?: Record<string, boolean>;
}

/**
 * A watch whose automatic hold holds a unit (last result `held`, inactive), in the profile at
 * `userDataDir` (its database is created and migrated if new), with the provider's experiment
 * choices stored first when given, so the provider registers with them at launch. Nothing is
 * ever held at the provider (architecture-notes §12.33).
 */
export function seedHeldWatch(userDataDir: string, seed: HeldWatchSeed): { watchId: number } {
  return runSeed({
    op: 'held-watch',
    dbPath: path.join(userDataDir, 'wa-stay.db'),
    watch: seed.watch,
    hold: { ...seed.hold, expiresAt: seed.hold.expiresAt.toISOString() },
    ...(seed.experiments ? { experiments: seed.experiments } : {}),
  });
}
