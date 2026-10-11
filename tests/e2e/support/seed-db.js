/**
 * Writes test data into a WA Stay or v1.x database before an Electron smoke test launches the
 * app. `support/seed.ts` runs it with the Electron binary as Node (`ELECTRON_RUN_AS_NODE=1`), so
 * better-sqlite3's Electron build loads, and the app's own built code (`dist/main`) opens,
 * migrates and writes the database: the rows are exactly what the app would have written.
 *
 *   ELECTRON_RUN_AS_NODE=1 electron tests/e2e/support/seed-db.js <job.json>
 *
 * The job is JSON `{ op, out, ... }`; the result is written as JSON to `out`.
 * - `legacy-v5`: `{ file, dump }` replays a v1.2.0 (schema v5) dump into `file`, in WAL mode
 *   and closed cleanly, as a v1.x install leaves its `parkstay.db`.
 * - `held-snipe`: `{ dbPath, snipe, hold, notification }` opens (and migrates) the WA Stay
 *   database, creates the snipe, records its hold (`markHeld`, as a placed hold does) and, if
 *   asked, the `snipe_held` notification. Result: `{ snipeId, notificationId }`.
 *
 * Nothing here talks to a provider: no hold is ever placed (architecture-notes §12.33).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MAIN = path.join(ROOT, 'dist', 'main', 'main');

function legacyV5(job) {
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.dirname(job.file), { recursive: true });
  const db = new Database(job.file);
  try {
    db.pragma('foreign_keys = OFF');
    db.exec(fs.readFileSync(job.dump, 'utf8'));
    db.pragma('journal_mode = WAL');
  } finally {
    db.close();
  }
  return { file: job.file };
}

function heldSnipe(job) {
  const { openDatabase, closeDatabase } = require(path.join(MAIN, 'database', 'connection'));
  const repositories = require(path.join(MAIN, 'database', 'repositories'));
  const db = openDatabase(job.dbPath);
  try {
    const userId = new repositories.UserRepository(db).createLocalProfileIfMissing().id;
    const snipes = new repositories.SiteSniperRepository(db);
    const snipe = snipes.create(userId, job.snipe);
    const { reference, expiresAt, unitId, paymentUrl } = job.hold;
    snipes.markHeld(snipe.id, reference, new Date(expiresAt), paymentUrl, unitId);

    let notificationId = null;
    if (job.notification) {
      notificationId = new repositories.NotificationRepository(db).create({
        ...job.notification,
        userId,
        relatedId: snipe.id,
        relatedType: 'snipe',
        actionUrl: `/site-sniper/${snipe.id}`,
      }).id;
    }
    return { snipeId: snipe.id, notificationId };
  } finally {
    closeDatabase(db);
  }
}

const OPS = { 'legacy-v5': legacyV5, 'held-snipe': heldSnipe };

const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const run = OPS[job.op];
if (!run) throw new Error(`seed-db: unknown op ${job.op}`);
fs.writeFileSync(job.out, JSON.stringify(run(job)));
