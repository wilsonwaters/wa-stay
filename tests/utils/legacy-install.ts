/**
 * Helpers for the legacy install migration tests (`migration/legacy-install.ts`): a temp
 * appData holding a v1.x data folder made from the schema fixtures, the real dependencies
 * with a recording logger and prompt, and file fingerprints to prove the source is untouched.
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveAppPaths, type AppPaths } from '@main/app/paths';
import type {
  FailureChoice,
  FailurePrompt,
  LegacyInstallDeps,
} from '@main/migration/legacy-install';
import type { FixtureName } from '@tests/fixtures/db/constants';

const FIXTURE_DIR = path.join(__dirname, '../fixtures/db');

export interface TempInstall {
  /** The temp appData folder; remove it with `removeTempInstall`. */
  appData: string;
  /** Packaged paths under `appData`: `WA Stay/…` and `parkstay-bookings/…`. */
  paths: AppPaths & { legacyUserData: string; legacyDbPath: string };
}

/** A fresh `fs.mkdtempSync` appData with the WA Stay and legacy paths under it (none created). */
export function tempInstall(): TempInstall {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-appdata-'));
  const paths = resolveAppPaths({
    appData,
    env: {},
    isPackaged: true,
    appPath: path.join(appData, 'resources', 'app.asar'),
  });
  if (!paths.legacyUserData || !paths.legacyDbPath) throw new Error('legacy paths expected');
  return {
    appData,
    paths: { ...paths, legacyUserData: paths.legacyUserData, legacyDbPath: paths.legacyDbPath },
  };
}

export function removeTempInstall(install: TempInstall): void {
  fs.rmSync(install.appData, { recursive: true, force: true });
}

/**
 * Writes a v1.x database at `file` from a schema fixture, in WAL mode (as v1.x ran it),
 * closed cleanly: only the database file is left.
 */
export function writeLegacyDatabase(file: string, fixture: FixtureName): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  try {
    db.pragma('foreign_keys = OFF');
    db.exec(fs.readFileSync(path.join(FIXTURE_DIR, `${fixture}.sql`), 'utf8'));
    db.pragma('journal_mode = WAL');
  } finally {
    db.close();
  }
}

export const WAL_ONLY_WATCH = 'Committed only in the -wal file';

/**
 * A v1.x database whose last transaction is only in its `-wal`: a copy of watch 1 named
 * `WAL_ONLY_WATCH`. The three files are copied into `dir` while the writer is still open
 * (as a crashed v1.x app, or the installer's snapshot, leaves them); the writer works on its
 * own file elsewhere. Returns the copied database path.
 */
export function writeLegacyDatabaseWithWalRow(dir: string, fixture: FixtureName): string {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-wal-writer-'));
  const source = path.join(work, 'writer.db');
  try {
    writeLegacyDatabase(source, fixture);
    const writer = new Database(source);
    try {
      writer.pragma('wal_autocheckpoint = 0');
      const columns = (writer.pragma('table_info(watches)') as Array<{ name: string }>)
        .map((column) => column.name)
        .filter((name) => name !== 'id' && name !== 'name');
      writer
        .prepare(
          `INSERT INTO watches (name, ${columns.join(', ')}) SELECT ?, ${columns.join(', ')} FROM watches WHERE id = 1`
        )
        .run(WAL_ONLY_WATCH);

      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, 'parkstay.db');
      for (const suffix of ['', '-wal', '-shm']) {
        fs.copyFileSync(`${source}${suffix}`, `${target}${suffix}`);
      }
      return target;
    } finally {
      writer.close();
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** The watch names in a database file read on its own, without its `-wal`. */
export function watchNamesWithoutWal(file: string): string[] {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-main-only-'));
  try {
    const copy = path.join(work, 'main-only.db');
    fs.copyFileSync(file, copy);
    const db = new Database(copy, { readonly: true });
    try {
      return (
        db.prepare('SELECT name FROM watches ORDER BY id').all() as Array<{ name: string }>
      ).map((row) => row.name);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Every file in `dir` with its sha256. */
export function fingerprint(dir: string): Record<string, string> {
  return Object.fromEntries(
    fs
      .readdirSync(dir)
      .sort()
      .map((name) => [name, sha256(path.join(dir, name))])
  );
}

/** SQLite's sidecars: they may appear next to a source opened read-only. */
export const isSqliteSidecar = (name: string): boolean => /-(wal|shm)$/.test(name);

/**
 * Proves a folder is untouched since `before`: every file is still there, byte-identical,
 * and nothing new appeared except SQLite's `-wal`/`-shm` sidecars.
 */
export function expectUnchanged(dir: string, before: Record<string, string>): void {
  const after = fingerprint(dir);
  for (const [name, hash] of Object.entries(before)) {
    if (isSqliteSidecar(name)) {
      expect(after).toHaveProperty([name]);
    } else {
      expect({ name, hash: after[name] }).toEqual({ name, hash });
    }
  }
  const added = Object.keys(after).filter((name) => !(name in before));
  expect(added.filter((name) => !isSqliteSidecar(name))).toEqual([]);
}

export interface RecordedDeps extends LegacyInstallDeps {
  /** Every log line, as `level: message`. */
  lines: string[];
  /** The prompts shown, in order. */
  prompts: FailurePrompt[];
  /** The delays waited before retries. */
  sleeps: number[];
}

/**
 * The real dependencies (fs, better-sqlite3) with a recording logger, a fixed clock, no
 * real waits, and a prompt that answers `answers` in order (then Quit).
 */
export function recordedDeps(
  answers: FailureChoice[] = [],
  overrides: Partial<LegacyInstallDeps> = {}
): RecordedDeps {
  const lines: string[] = [];
  const prompts: FailurePrompt[] = [];
  const sleeps: number[] = [];
  const queue = [...answers];
  let tick = Date.parse('2026-10-04T00:00:00.000Z');
  return {
    fs,
    openDatabase: (file, options) => new Database(file, options),
    prompt: async (request) => {
      prompts.push(request);
      return queue.shift() ?? 'quit';
    },
    logger: {
      info: (message: string) => lines.push(`info: ${message}`),
      warn: (message: string) => lines.push(`warn: ${message}`),
      error: (message: string) => lines.push(`error: ${message}`),
    },
    clock: () => new Date((tick += 5)),
    appVersion: '2.0.0-test',
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    lines,
    prompts,
    sleeps,
    ...overrides,
  };
}

export function readMarker(install: TempInstall): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(install.paths.markerPath, 'utf8')) as Record<string, unknown>;
}
