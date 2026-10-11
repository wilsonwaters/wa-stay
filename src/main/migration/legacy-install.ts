/**
 * First-run migration of a v1.x install to WA Stay (architecture-notes §6, §12.12, §12.23).
 *
 * v1.x kept its data in `<appData>/<LEGACY_DATA_FOLDER_NAME>`; WA Stay keeps it in
 * `<appData>/WA Stay` (`app/paths.ts`). On the first start after the upgrade, before the
 * database is opened and before the vault's first use, this copies:
 *
 * - the v1.x database to `wa-stay.db` with SQLite's online backup, from a read-only
 *   connection. That gives a consistent copy even while a v1.x app is still running, and
 *   includes any transactions still in the `-wal` file. The copy then goes through the
 *   normal migrations (`openDatabase`), and P5's `migrateLegacySecrets` re-encrypts its
 *   legacy secrets.
 *
 * The v1.x Gmail OTP sign-in (`gmail-oauth.json`) is not copied: the feature is gone (P7),
 * and nothing would read it.
 *
 * The source is the live legacy folder when it exists, else the v2 installer's
 * `legacy-snapshot` (taken before the v1 uninstaller could delete the folder), else there
 * is nothing to migrate.
 *
 * **The legacy folder and the snapshot are never deleted or modified.** They are the only
 * backup of the user's data as v1.x left it, including the pre-vault secrets that
 * `migrateLegacySecrets` re-encrypts in the copy. (Opening the source read-only may leave
 * SQLite's empty `-wal`/`-shm` sidecars next to it; the database file is never written.)
 *
 * `migration.json` in the data folder records what happened:
 *
 * | status | meaning | next start |
 * | --- | --- | --- |
 * | `in-progress` | a copy started and did not finish (crash or kill) | sets aside any `wa-stay.db`, then copies again |
 * | `complete` | copied | the follow-ups still `pending`, if any |
 * | `failed` | the copy failed and the user chose Quit | tries again |
 * | `declined` | the copy failed and the user chose "Start fresh" | nothing |
 * | `skipped` | `wa-stay.db` already existed, so nothing was copied over it | nothing |
 *
 * A fresh install writes no marker, so a snapshot the installer takes later is still used.
 * The copy is written to `wa-stay.db.migrating`, checked, then renamed into place, so
 * `wa-stay.db` is either absent or complete. Logs carry paths, sizes, schema versions and
 * error codes, never row data or secrets.
 *
 * **A database in the data folder is never deleted.** A start that goes on to open
 * `wa-stay.db` without a finished copy (`fresh-install`, `declined`) first replaces or
 * removes a non-final marker, so a later start never takes the user's database for an
 * unfinished copy. If that fails too, the redo moves whatever is at `wa-stay.db` aside to
 * `wa-stay.db.before-legacy-<time>` instead of deleting it.
 *
 * The follow-ups of a copy (the welcome notice and launch at login under WA Stay,
 * `finishLegacyInstall`) are `pending` in the `complete` marker until each succeeds, so a
 * start that crashes after the copy leaves them to the next one.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { NotificationInput } from '@shared/types';
import { NotificationType } from '@shared/types/common.types';
import { LEGACY_DATABASE_FILE_NAME, type AppPaths } from '../app/paths';
import { LATEST_SCHEMA_VERSION } from '../database/connection';
import { logger as appLogger } from '../utils/logger';

export type MigrationStatus = 'in-progress' | 'complete' | 'failed' | 'declined' | 'skipped';

/** What a copy leaves to do once the database is open (`finishLegacyInstall`). */
export type FollowUp = 'welcome' | 'loginItems';

/** In the order they run. */
export const FOLLOW_UPS: readonly FollowUp[] = ['welcome', 'loginItems'];

/** Statuses after which the migration never runs again. */
const FINAL_STATUSES: readonly MigrationStatus[] = ['complete', 'declined', 'skipped'];

/** Where the data came from: the live legacy folder or the installer's snapshot. */
export type SourceKind = 'legacy' | 'snapshot';

/**
 * Why a copy failed, as shown to the user and recorded in the marker. `unreadable` is the
 * source (the old data folder), `unwritable` the WA Stay data folder.
 */
export type FailureKind =
  'locked' | 'corrupt' | 'disk-full' | 'unreadable' | 'unwritable' | 'error';

export interface MigrationMarker {
  version: 1;
  status: MigrationStatus;
  /** The app version that wrote the marker. */
  appVersion: string;
  /** The folder the data is copied from. */
  source?: string;
  sourceKind?: SourceKind;
  startedAt?: string;
  /** `complete`: the source database's schema version (`MAX(version)` of `migrations`). */
  sourceSchemaVersion?: number;
  migratedAt?: string;
  /** `complete`: the source files copied. */
  copied?: string[];
  /** `complete`: the copy's follow-ups, each `pending` until it has succeeded once. */
  followUps?: Partial<Record<FollowUp, 'pending' | 'done'>>;
  /** `failed`, `declined`: why the copy failed. `skipped`: `target-exists`. */
  reason?: FailureKind | 'target-exists';
  /** `failed`: the error code or message (never data). */
  error?: string;
  failedAt?: string;
  declinedAt?: string;
  skippedAt?: string;
  /** `skipped`: the database that already existed. */
  target?: string;
}

export type LegacyInstallOutcome =
  /** The marker says it already ran (`complete`, `declined` or `skipped`); follow-ups may be pending. */
  | 'already-done'
  /** No legacy data: nothing was written. */
  | 'fresh-install'
  /** `wa-stay.db` already existed: nothing was copied over it. */
  | 'target-exists'
  /** Copied: `wa-stay.db` is ready to open. */
  | 'migrated'
  /** The copy failed and the user chose "Start fresh". */
  | 'declined'
  /** The copy failed and the user chose Quit: start nothing. */
  | 'quit';

export interface LegacyInstallResult {
  outcome: LegacyInstallOutcome;
  /** The folder the data came from (or that was kept, when not copied). */
  sourceDir?: string;
  sourceKind?: SourceKind;
  sourceSchemaVersion?: number;
  /** The copy's follow-ups not done yet: all of them after `migrated`, then those that failed. */
  pendingFollowUps?: FollowUp[];
}

/** What the user is asked after a failed copy. */
export interface FailurePrompt {
  reason: FailureKind;
  /** One sentence for the user. */
  message: string;
  /** The folder that keeps the old data, shown so the user can find it. */
  keptDir: string;
}

export type FailureChoice = 'retry' | 'start-fresh' | 'quit';

/** The file-system calls the migration makes (a fault-injecting fake in tests). */
export type MigrationFs = Pick<
  typeof fs,
  | 'closeSync'
  | 'copyFileSync'
  | 'existsSync'
  | 'fsyncSync'
  | 'mkdirSync'
  | 'openSync'
  | 'readFileSync'
  | 'renameSync'
  | 'rmSync'
  | 'statSync'
  | 'writeFileSync'
>;

export interface LegacyInstallDeps {
  fs: MigrationFs;
  /** Opens a SQLite database (`new Database(file, options)`). */
  openDatabase: (file: string, options?: Database.Options) => Database.Database;
  /** Asks the user what to do after a failed copy (production: a message box). */
  prompt: (request: FailurePrompt) => Promise<FailureChoice>;
  logger: {
    info(message: string): unknown;
    warn(message: string): unknown;
    error(message: string): unknown;
  };
  clock: () => Date;
  appVersion: string;
  /** Waits before retrying a locked source. Defaults to a timer. */
  sleep?: (ms: number) => Promise<void>;
}

export type LegacyInstallPaths = Pick<
  AppPaths,
  'userData' | 'dbPath' | 'legacyDbPath' | 'snapshotDir' | 'markerPath'
>;

/** How the source database is opened: read-only, never created, waiting up to 5 s for a lock. */
export const SOURCE_OPEN_OPTIONS: Readonly<Database.Options> = {
  readonly: true,
  fileMustExist: true,
  timeout: 5000,
};

/** The waits before each retry of a locked source: three retries, then the user is asked. */
export const LOCK_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000];

/**
 * Backup steps in a row that copy nothing (the source stays locked) before the copy gives
 * up as locked. better-sqlite3 would otherwise retry a busy step for ever.
 */
const STALLED_BACKUP_STEPS = 3;

/** Pages copied per backup step (better-sqlite3's default). */
const BACKUP_PAGES_PER_STEP = 100;

/** A copy that takes longer than this logs its progress at this interval. */
const PROGRESS_LOG_INTERVAL_MS = 2000;

/** SQLite's sidecars of a database file, and the file itself (`''`). */
const DATABASE_SUFFIXES = ['', '-wal', '-shm', '-journal'] as const;

/**
 * Where a source SQLite cannot open in place is copied first (in the data folder). It holds
 * a copy of the legacy database, pre-vault secrets included: removed after the copy, and
 * at the start of every run in case a killed copy left it.
 */
export const STAGING_DIR_NAME = '.legacy-staging';

/** A database a redo found at `wa-stay.db` moves to `wa-stay.db<this><time>`. */
export const SET_ASIDE_INFIX = '.before-legacy-';

const FAILURE_MESSAGES: Record<FailureKind, (paths: LegacyInstallPaths) => string> = {
  locked: () =>
    'The old database is in use by another program. Close WA ParkStay Bookings if it is running, then choose Retry.', // legacy-name-ok
  corrupt: () => 'The old database is damaged, so it could not be copied.',
  'disk-full': () => 'There is not enough free disk space to copy your data.',
  unreadable: () => 'The old data folder could not be read.',
  unwritable: ({ userData }) =>
    `WA Stay could not write to its data folder, ${userData}. Check that the folder is not read-only or in use by another program, then choose Retry.`,
  error: () => 'Your data could not be copied.',
};

/** A failure the migration recognised itself (a check that did not pass). */
class LegacyInstallError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = 'LegacyInstallError';
  }
}

interface Source {
  kind: SourceKind;
  dir: string;
  dbPath: string;
}

interface CopiedDatabase {
  schemaVersion: number;
  bytes: number;
}

/**
 * Copies a v1.x install's data into the WA Stay data folder, once. Call it after `ready`
 * and before the database is opened. It never throws for a failed copy: the user chooses
 * Retry, "Start fresh" or Quit (`quit` means the caller starts nothing).
 */
export async function migrateLegacyInstall(
  paths: LegacyInstallPaths,
  deps: LegacyInstallDeps
): Promise<LegacyInstallResult> {
  const { fs: files, logger: log } = deps;

  removeStagingDir(paths, deps);

  const marker = readMarker(paths.markerPath, files, log);
  if (marker && FINAL_STATUSES.includes(marker.status)) {
    const pending = pendingFollowUps(marker);
    if (pending.length === 0) {
      log.info(`legacy-install: already done (${marker.status}); outcome already-done`);
      return { outcome: 'already-done' };
    }
    log.info(
      `legacy-install: already done (${marker.status}); outcome already-done, follow-ups pending: ${pending.join(', ')}`
    );
    return {
      outcome: 'already-done',
      sourceDir: marker.source,
      sourceKind: marker.sourceKind,
      pendingFollowUps: pending,
    };
  }

  const tempPath = `${paths.dbPath}.migrating`;
  const source = chooseSource(paths, files);
  if (!source) {
    try {
      removeDatabaseFiles(tempPath, files);
    } catch (error) {
      log.warn(`legacy-install: could not remove ${tempPath}: ${errorDetail(error)}`);
    }
    // The app now opens wa-stay.db as the user's own: an unfinished copy's marker must go
    if (marker) settleMarker(paths, deps, null);
    log.info('legacy-install: no legacy data found; outcome fresh-install');
    return { outcome: 'fresh-install' };
  }
  const kept = { sourceDir: source.dir, sourceKind: source.kind };

  // A previous start stopped during the copy (or its marker could not be updated after)
  const redo = marker?.status === 'in-progress';
  if (redo) {
    log.warn('legacy-install: a previous copy did not finish; copying again');
  } else if (files.existsSync(paths.dbPath)) {
    writeMarkerQuietly(paths, deps, {
      ...markerBase(deps, source),
      status: 'skipped',
      reason: 'target-exists',
      target: paths.dbPath,
      skippedAt: deps.clock().toISOString(),
    });
    log.warn(
      `legacy-install: ${paths.dbPath} already exists, so ${source.dbPath} was not copied over it; outcome target-exists`
    );
    return { outcome: 'target-exists', ...kept };
  }

  for (;;) {
    const started = deps.clock();
    const created: string[] = [];
    try {
      onTarget(() => {
        // What a killed copy left: its temp copy, and whatever is at wa-stay.db (kept)
        removeDatabaseFiles(tempPath, files);
        if (redo) setAsideDatabase(paths, deps);
        writeMarker(paths.markerPath, files, {
          ...markerBase(deps, source),
          status: 'in-progress',
          startedAt: started.toISOString(),
        });
      });
      log.info(`legacy-install: copying the ${source.kind} data from ${source.dir}`);

      const database = await copyDatabase(source, paths, deps, created);
      const copied = [LEGACY_DATABASE_FILE_NAME];

      onTarget(() =>
        writeMarker(paths.markerPath, files, {
          ...markerBase(deps, source),
          status: 'complete',
          startedAt: started.toISOString(),
          sourceSchemaVersion: database.schemaVersion,
          migratedAt: deps.clock().toISOString(),
          copied,
          followUps: { welcome: 'pending', loginItems: 'pending' },
        })
      );
      const ms = deps.clock().getTime() - started.getTime();
      log.info(
        `legacy-install: outcome migrated from ${source.kind} ${source.dir}: schema v${database.schemaVersion}, ${database.bytes} bytes, ${ms} ms (${copied.join(', ')})`
      );
      return {
        outcome: 'migrated',
        ...kept,
        sourceSchemaVersion: database.schemaVersion,
        pendingFollowUps: [...FOLLOW_UPS],
      };
    } catch (error) {
      // Undo this attempt: the temp copy and anything it put in place. The source is
      // untouched. Best effort: the user is asked either way.
      try {
        removeDatabaseFiles(tempPath, files);
        for (const file of created.reverse()) removeDatabaseFiles(file, files);
      } catch (cleanupError) {
        log.warn(`legacy-install: could not undo the failed copy: ${errorDetail(cleanupError)}`);
      }

      const reason = classify(error);
      const detail = errorDetail(error);
      log.error(`legacy-install: the copy from ${source.dbPath} failed (${reason}: ${detail})`);
      writeMarkerQuietly(paths, deps, {
        ...markerBase(deps, source),
        status: 'failed',
        reason,
        error: detail,
        failedAt: deps.clock().toISOString(),
      });

      const choice = await deps.prompt({
        reason,
        message: FAILURE_MESSAGES[reason](paths),
        keptDir: source.dir,
      });
      log.info(`legacy-install: the user chose ${choice}`);
      if (choice === 'retry') continue;
      if (choice === 'quit') return { outcome: 'quit', ...kept };

      // The app now opens a new wa-stay.db: no in-progress marker may outlive this start
      settleMarker(paths, deps, {
        ...markerBase(deps, source),
        status: 'declined',
        reason,
        declinedAt: deps.clock().toISOString(),
      });
      log.warn(`legacy-install: starting fresh; the old data stays in ${source.dir}`);
      return { outcome: 'declined', ...kept };
    }
  }
}

function markerBase(
  deps: LegacyInstallDeps,
  source: Source
): Pick<MigrationMarker, 'version' | 'appVersion' | 'source' | 'sourceKind'> {
  return { version: 1, appVersion: deps.appVersion, source: source.dir, sourceKind: source.kind };
}

/** The live legacy folder if it has a database, else the installer's snapshot, else none. */
function chooseSource(paths: LegacyInstallPaths, files: MigrationFs): Source | null {
  if (paths.legacyDbPath && files.existsSync(paths.legacyDbPath)) {
    return { kind: 'legacy', dir: path.dirname(paths.legacyDbPath), dbPath: paths.legacyDbPath };
  }
  const snapshotDb = path.join(paths.snapshotDir, LEGACY_DATABASE_FILE_NAME);
  if (files.existsSync(snapshotDb)) {
    return { kind: 'snapshot', dir: paths.snapshotDir, dbPath: snapshotDb };
  }
  return null;
}

/**
 * Backs the source up to `<dbPath>.migrating`, checks the copy and renames it into place.
 * A locked source is retried (`LOCK_RETRY_DELAYS_MS`). A source SQLite cannot open where it
 * is (a read-only folder with a `-wal` but no `-shm`) is copied to the staging folder in the
 * data folder first and backed up from there.
 */
async function copyDatabase(
  source: Source,
  paths: LegacyInstallPaths,
  deps: LegacyInstallDeps,
  created: string[]
): Promise<CopiedDatabase> {
  const { fs: files, logger: log } = deps;
  const tempPath = `${paths.dbPath}.migrating`;
  const stagingDir = path.join(paths.userData, STAGING_DIR_NAME);
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  onTarget(() => files.mkdirSync(paths.userData, { recursive: true }));

  let from = source.dbPath;
  let staged = false;
  let retries = 0;
  try {
    for (;;) {
      try {
        await backupSource(from, tempPath, deps);
        break;
      } catch (error) {
        onTarget(() => removeDatabaseFiles(tempPath, files));
        const reason = classify(error);
        if (reason === 'locked' && retries < LOCK_RETRY_DELAYS_MS.length) {
          const delay = LOCK_RETRY_DELAYS_MS[retries];
          retries += 1;
          log.warn(
            `legacy-install: the legacy database is locked (${errorDetail(error)}); retry ${retries} of ${LOCK_RETRY_DELAYS_MS.length} in ${delay} ms`
          );
          await sleep(delay);
          continue;
        }
        if (isCantOpen(error) && !staged) {
          staged = true;
          onTarget(() => {
            files.rmSync(stagingDir, { recursive: true, force: true });
            files.mkdirSync(stagingDir, { mode: 0o700 });
          });
          from = stageSource(source.dbPath, stagingDir, files);
          log.warn(
            `legacy-install: SQLite could not open ${source.dbPath} in place (${errorDetail(error)}); copying it from a staging folder`
          );
          continue;
        }
        throw error;
      }
    }
  } finally {
    if (staged) onTarget(() => files.rmSync(stagingDir, { recursive: true, force: true }));
  }

  return onTarget(() => {
    const schemaVersion = verifyCopy(tempPath, deps);
    // wa-stay.db is absent here (checked before the copy, or set aside). If one appeared
    // anyway, it is the user's: stop rather than replace it.
    if (files.existsSync(paths.dbPath)) {
      throw new LegacyInstallError('error', `${paths.dbPath} appeared during the copy`, 'EEXIST');
    }
    // Sidecars of an absent database are stray: SQLite would replay a stray -wal into the
    // copy.
    removeDatabaseFiles(paths.dbPath, files);
    files.renameSync(tempPath, paths.dbPath);
    created.push(paths.dbPath);
    return { schemaVersion, bytes: files.statSync(paths.dbPath).size };
  });
}

/** Opens the source read-only, checks it and backs it up to `target`. */
async function backupSource(file: string, target: string, deps: LegacyInstallDeps): Promise<void> {
  const db = deps.openDatabase(file, { ...SOURCE_OPEN_OPTIONS });
  try {
    const check = db.pragma('quick_check', { simple: true });
    if (check !== 'ok') {
      throw new LegacyInstallError('corrupt', `quick_check: ${String(check)}`);
    }
    const started = deps.clock().getTime();
    let lastLog = started;
    let previousRemaining = -1;
    let stalled = 0;
    await db.backup(target, {
      progress: ({ totalPages, remainingPages }) => {
        if (remainingPages === previousRemaining) {
          stalled += 1;
          if (stalled >= STALLED_BACKUP_STEPS) {
            throw new LegacyInstallError(
              'locked',
              'the source stayed locked during the copy',
              'SQLITE_BUSY'
            );
          }
        } else {
          stalled = 0;
          previousRemaining = remainingPages;
        }
        const now = deps.clock().getTime();
        if (now - lastLog >= PROGRESS_LOG_INTERVAL_MS) {
          lastLog = now;
          deps.logger.info(
            `legacy-install: copying, ${totalPages - remainingPages} of ${totalPages} pages after ${now - started} ms`
          );
        }
        return BACKUP_PAGES_PER_STEP;
      },
    });
  } finally {
    db.close();
  }
}

/** Copies the database and its `-wal` (the `-shm` is rebuilt) into `dir`; returns the copy. */
function stageSource(dbPath: string, dir: string, files: MigrationFs): string {
  const staged = path.join(dir, path.basename(dbPath));
  files.copyFileSync(dbPath, staged);
  if (files.existsSync(`${dbPath}-wal`)) files.copyFileSync(`${dbPath}-wal`, `${staged}-wal`);
  return staged;
}

/**
 * `PRAGMA integrity_check` on the copy and its schema version. The copy is opened
 * read-write, so closing it removes its own `-wal`/`-shm` before the rename.
 */
function verifyCopy(file: string, deps: LegacyInstallDeps): number {
  const copy = deps.openDatabase(file, { fileMustExist: true });
  try {
    const check = copy.pragma('integrity_check', { simple: true });
    if (check !== 'ok') {
      throw new LegacyInstallError('corrupt', `integrity_check: ${String(check)}`);
    }
    const version = readSchemaVersion(copy);
    if (version > LATEST_SCHEMA_VERSION) {
      deps.logger.warn(
        `legacy-install: the legacy database is at schema v${version}, newer than this build (v${LATEST_SCHEMA_VERSION}); it is copied but cannot be opened by this build`
      );
    }
    return version;
  } finally {
    copy.close();
  }
}

/** `MAX(version)` of `migrations`; 0 for a database older than the table. */
function readSchemaVersion(db: Database.Database): number {
  const table = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'migrations'")
    .get();
  if (!table) return 0;
  const row = db.prepare('SELECT MAX(version) AS version FROM migrations').get() as {
    version: number | null;
  };
  return row.version ?? 0;
}

/** Removes a database file and its SQLite sidecars, if present. */
function removeDatabaseFiles(file: string, files: MigrationFs): void {
  for (const suffix of DATABASE_SUFFIXES) {
    files.rmSync(`${file}${suffix}`, { force: true });
  }
}

/**
 * The redo's first step: whatever is at `wa-stay.db` moves to
 * `wa-stay.db.before-legacy-<time>`, with its sidecars, and is never deleted. It is usually
 * this migration's own copy, renamed into place just before a crash, but a stale
 * `in-progress` marker can also sit next to a database the user has been using. The
 * sidecars move first, so a crash part-way leaves a `wa-stay.db` SQLite reads on its own.
 */
function setAsideDatabase(paths: LegacyInstallPaths, deps: LegacyInstallDeps): void {
  const { fs: files } = deps;
  const present = DATABASE_SUFFIXES.filter((suffix) =>
    files.existsSync(`${paths.dbPath}${suffix}`)
  );
  if (present.length === 0) return;

  const stamp = deps.clock().toISOString().replace(/[:.]/g, '-');
  const base = `${paths.dbPath}${SET_ASIDE_INFIX}${stamp}`;
  let aside = base;
  for (
    let n = 1;
    DATABASE_SUFFIXES.some((suffix) => files.existsSync(`${aside}${suffix}`));
    n += 1
  ) {
    aside = `${base}-${n}`;
  }
  // The database file last
  for (const suffix of [...present.filter(Boolean), ...present.filter((suffix) => !suffix)]) {
    files.renameSync(`${paths.dbPath}${suffix}`, `${aside}${suffix}`);
  }
  deps.logger.warn(
    `legacy-install: moved ${paths.dbPath} aside to ${aside} before copying again; it is kept, not deleted`
  );
}

/** Removes the staging folder a killed copy may have left (it holds legacy secrets). Best effort. */
function removeStagingDir(paths: LegacyInstallPaths, deps: LegacyInstallDeps): void {
  const dir = path.join(paths.userData, STAGING_DIR_NAME);
  if (!deps.fs.existsSync(dir)) return;
  try {
    deps.fs.rmSync(dir, { recursive: true, force: true });
    deps.logger.warn(`legacy-install: removed ${dir}, left by a copy that did not finish`);
  } catch (error) {
    deps.logger.warn(`legacy-install: could not remove ${dir}: ${errorDetail(error)}`);
  }
}

/** The `complete` marker's follow-ups that are not done, in order. */
function pendingFollowUps(marker: MigrationMarker): FollowUp[] {
  if (marker.status !== 'complete' || !marker.followUps) return [];
  return FOLLOW_UPS.filter((followUp) => marker.followUps?.[followUp] !== 'done');
}

function readMarker(
  markerPath: string,
  files: MigrationFs,
  log: Pick<LegacyInstallDeps['logger'], 'warn'>
): MigrationMarker | null {
  if (!files.existsSync(markerPath)) return null;
  try {
    const parsed = JSON.parse(files.readFileSync(markerPath, 'utf8')) as Partial<MigrationMarker>;
    if (parsed && typeof parsed === 'object' && typeof parsed.status === 'string') {
      return parsed as MigrationMarker;
    }
  } catch {
    // Damaged: treated as absent below
  }
  log.warn(`legacy-install: ${markerPath} is unreadable; treating it as absent`);
  return null;
}

/** Writes the marker atomically: a temp file, fsynced, then renamed over it. */
function writeMarker(markerPath: string, files: MigrationFs, marker: MigrationMarker): void {
  files.mkdirSync(path.dirname(markerPath), { recursive: true });
  const temp = `${markerPath}.tmp`;
  try {
    const fd = files.openSync(temp, 'w');
    try {
      files.writeFileSync(fd, `${JSON.stringify(marker, null, 2)}\n`);
      files.fsyncSync(fd);
    } finally {
      files.closeSync(fd);
    }
    files.renameSync(temp, markerPath);
  } catch (error) {
    files.rmSync(temp, { force: true });
    throw error;
  }
}

/** `writeMarker` for the failure paths: a marker that cannot be written is logged, not thrown. */
function writeMarkerQuietly(
  paths: LegacyInstallPaths,
  deps: LegacyInstallDeps,
  marker: MigrationMarker
): boolean {
  try {
    writeMarker(paths.markerPath, deps.fs, marker);
    return true;
  } catch (error) {
    deps.logger.warn(
      `legacy-install: could not write ${paths.markerPath} (${marker.status}): ${errorDetail(error)}`
    );
    return false;
  }
}

/**
 * Before the app opens `wa-stay.db` without a finished copy (`fresh-install`, `declined`):
 * writes `replacement`, or (with none, or when that write fails) removes the marker, so no
 * `in-progress` marker outlives this start. Best effort: if both fail, the next start's redo
 * still sets that database aside rather than deleting it.
 */
function settleMarker(
  paths: LegacyInstallPaths,
  deps: LegacyInstallDeps,
  replacement: MigrationMarker | null
): void {
  if (replacement && writeMarkerQuietly(paths, deps, replacement)) return;
  try {
    deps.fs.rmSync(paths.markerPath, { force: true });
    deps.logger.warn(
      `legacy-install: removed ${paths.markerPath}, left by a copy that did not finish`
    );
  } catch (error) {
    deps.logger.warn(
      `legacy-install: could not remove ${paths.markerPath}: ${errorDetail(error)}; a later copy moves ${paths.dbPath} aside first`
    );
  }
}

function errorCode(error: unknown): string {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return code === undefined || code === null ? '' : String(code);
}

/** The error's code and message, for the log and the marker (SQLite and fs messages hold no data). */
function errorDetail(error: unknown): string {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  return code && !message.includes(code) ? `${code} ${message}` : message;
}

function isCantOpen(error: unknown): boolean {
  return errorCode(error).startsWith('SQLITE_CANTOPEN');
}

/**
 * Runs a step that writes the WA Stay data folder. Its failure is reported as that folder's
 * (`unwritable`, naming it), not as the old data folder's (`unreadable`).
 */
function onTarget<T>(step: () => T): T {
  try {
    return step();
  } catch (error) {
    if (error instanceof LegacyInstallError) throw error;
    const code = errorCode(error) || undefined;
    throw new LegacyInstallError(classifyTarget(error), errorDetail(error), code);
  }
}

/** A data-folder failure: full, damaged copy, blocked (read-only, denied, in use) or other. */
function classifyTarget(error: unknown): FailureKind {
  const kind = classify(error);
  if (kind === 'disk-full' || kind === 'corrupt') return kind;
  const code = errorCode(error);
  if (
    kind === 'unreadable' ||
    kind === 'locked' ||
    code === 'EROFS' ||
    code === 'EBUSY' ||
    code.startsWith('SQLITE_READONLY')
  ) {
    return 'unwritable';
  }
  return 'error';
}

function classify(error: unknown): FailureKind {
  if (error instanceof LegacyInstallError) return error.kind;
  const code = errorCode(error);
  if (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED')) return 'locked';
  if (code.startsWith('SQLITE_CORRUPT') || code === 'SQLITE_NOTADB') return 'corrupt';
  if (code === 'ENOSPC' || code.startsWith('SQLITE_FULL')) return 'disk-full';
  if (
    code.startsWith('SQLITE_CANTOPEN') ||
    code.startsWith('SQLITE_PERM') ||
    code.startsWith('SQLITE_AUTH') ||
    code === 'EACCES' ||
    code === 'EPERM'
  ) {
    return 'unreadable';
  }
  return 'error';
}

/** The message box buttons, in order. */
const PROMPT_CHOICES: readonly FailureChoice[] = ['retry', 'start-fresh', 'quit'];

/** The part of Electron's `dialog` the production prompt uses. */
export interface PromptDialog {
  showMessageBox(options: {
    type: 'error';
    title: string;
    message: string;
    detail: string;
    buttons: string[];
    defaultId: number;
    cancelId: number;
    noLink: boolean;
  }): Promise<{ response: number }>;
}

/**
 * The production prompt: a message box (there is no window yet) with Retry, "Start fresh"
 * and Quit. Closing it counts as Quit.
 */
export function dialogPrompt(dialog: PromptDialog): LegacyInstallDeps['prompt'] {
  return async ({ message, keptDir }) => {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'WA Stay',
      message: 'WA Stay could not copy your data from WA ParkStay Bookings', // legacy-name-ok
      detail: [
        message,
        '',
        `Your old data is kept, unchanged, in:\n${keptDir}`,
        '',
        'Retry: try again.',
        'Start fresh: open WA Stay without your old data. It stays in that folder.',
        'Quit: close WA Stay and try again later.',
      ].join('\n'),
      buttons: ['Retry', 'Start fresh', 'Quit'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    return PROMPT_CHOICES[response] ?? 'quit';
  };
}

/** The dependencies for the running app. */
export function createLegacyInstallDeps(options: {
  dialog: PromptDialog;
  appVersion: string;
}): LegacyInstallDeps {
  return {
    fs,
    openDatabase: (file, databaseOptions) => new Database(file, databaseOptions),
    prompt: dialogPrompt(options.dialog),
    logger: appLogger,
    clock: () => new Date(),
    appVersion: options.appVersion,
  };
}

export const WELCOME_NOTICE_TITLE = 'Your data has moved to WA Stay';

export interface FinishLegacyInstallDeps {
  notifications: { create(input: NotificationInput): unknown };
  /** The local profile (it owns the notice). */
  userId: number;
  /** The migrated `launchOnStartup` setting. */
  launchOnStartup: boolean;
  /** Replaces the v1.x launch-at-login entry (`app/login-item.ts`). */
  replaceLoginItems: (launchOnStartup: boolean) => unknown;
  /** `<userData>/migration.json`: each follow-up is marked `done` there once it succeeds. */
  markerPath: string;
  /** Defaults to Node's `fs`. */
  fs?: MigrationFs;
  logger: { warn(message: string): unknown };
}

const FOLLOW_UP_NAMES: Record<FollowUp, string> = {
  welcome: 'add the welcome notice',
  loginItems: 're-register launch at login',
};

/**
 * The follow-ups of a copy, once the database is open: one in-app notice saying where the
 * old data is kept, and launch at login re-registered under the new identity. Each runs
 * while `pendingFollowUps` lists it: after the copy, and on every later start until it has
 * succeeded (a start that crashed after the copy, or a step that failed). Neither step
 * stops the app starting.
 */
export function finishLegacyInstall(
  result: LegacyInstallResult,
  deps: FinishLegacyInstallDeps
): void {
  const files = deps.fs ?? fs;
  const steps: Record<FollowUp, () => unknown> = {
    welcome: () =>
      deps.notifications.create({
        userId: deps.userId,
        type: NotificationType.INFO,
        title: WELCOME_NOTICE_TITLE,
        message:
          'Your watches, bookings, settings and connections were copied from WA ParkStay Bookings. ' + // legacy-name-ok
          `The old data is kept, unchanged, as a backup in ${result.sourceDir ?? 'the old data folder'}`,
      }),
    loginItems: () => deps.replaceLoginItems(deps.launchOnStartup),
  };

  for (const followUp of FOLLOW_UPS) {
    if (!result.pendingFollowUps?.includes(followUp)) continue;
    try {
      steps[followUp]();
    } catch (error) {
      deps.logger.warn(
        `legacy-install: could not ${FOLLOW_UP_NAMES[followUp]}: ${errorDetail(error)}; the next start tries again`
      );
      continue;
    }
    markFollowUpDone(followUp, deps.markerPath, files, deps.logger);
  }
}

/** Records one follow-up as done in the `complete` marker. Best effort: else it runs again. */
function markFollowUpDone(
  followUp: FollowUp,
  markerPath: string,
  files: MigrationFs,
  log: FinishLegacyInstallDeps['logger']
): void {
  try {
    const marker = readMarker(markerPath, files, log);
    if (marker?.status !== 'complete') return;
    writeMarker(markerPath, files, {
      ...marker,
      followUps: { ...marker.followUps, [followUp]: 'done' },
    });
  } catch (error) {
    log.warn(
      `legacy-install: could not record "${FOLLOW_UP_NAMES[followUp]}" as done in ${markerPath}: ${errorDetail(error)}; the next start does it again`
    );
  }
}
