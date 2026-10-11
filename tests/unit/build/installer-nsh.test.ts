/**
 * @jest-environment node
 *
 * `resources/installer.nsh`, the custom NSIS steps (B2; architecture-notes §12.12):
 * - electron-builder makes the shortcuts, so the script makes none and removes the ones v1.x
 *   made itself;
 * - uninstalling never offers to delete data during an update or in silent mode, and the v1.x
 *   data folder goes only after a second prompt that names it (default No);
 * - before the old v1.x uninstaller runs, a running v1.x app is closed (it holds the database
 *   open), then the v1.x data is copied (never moved) into `$APPDATA\WA Stay\legacy-snapshot\`;
 * - electron-builder's own finish page (runAfterFinish) is used, not a custom one.
 *
 * NSIS cannot run here: the CI Windows build compiles the script, and the manual Windows
 * checklist in the B2 spec covers the behaviour.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'resources/installer.nsh'), 'utf8');

/** The script's lines without comments (`;` outside a string) or blank lines. */
function codeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => {
      let quote: string | null = null;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'" || ch === '`') {
          quote = ch;
        } else if (ch === ';' || ch === '#') {
          return line.slice(0, i).trim();
        }
      }
      return line.trim();
    })
    .filter((line) => line !== '');
}

const CODE = codeLines(SOURCE);

/** The code lines of one `!macro name … !macroend`. */
function macro(name: string): string[] {
  const start = CODE.findIndex((line) => line === `!macro ${name}`);
  if (start < 0) throw new Error(`installer.nsh defines no macro ${name}`);
  const end = CODE.indexOf('!macroend', start);
  return CODE.slice(start + 1, end);
}

/** Index of the `${endIf}` that closes the block opened at `open`. */
function closingEndIf(lines: string[], open: number): number {
  let depth = 0;
  for (let i = open; i < lines.length; i += 1) {
    if (/^\$\{(if|ifNot)\}/i.test(lines[i])) depth += 1;
    if (/^\$\{endIf\}/i.test(lines[i])) depth -= 1;
    if (depth === 0) return i;
  }
  throw new Error(`No \${endIf} closes line ${open}: ${lines[open]}`);
}

const LEGACY_DATA_RMDIR = 'RMDir /r "$APPDATA\\parkstay-bookings"';

describe('installer.nsh', () => {
  it('reads as LF or CRLF alike', () => {
    expect(codeLines(SOURCE.replace(/\n/g, '\r\n'))).toEqual(CODE);
  });

  it('creates no shortcuts (electron-builder makes the WA Stay ones)', () => {
    expect(SOURCE).not.toMatch(/CreateShortCut/i);
  });

  it('removes the v1.x shortcuts for the current user and for all users', () => {
    expect(macro('waStayRemoveLegacyShortcuts')).toEqual([
      'Delete "$DESKTOP\\WA ParkStay Bookings.lnk"',
      'Delete "$SMPROGRAMS\\WA ParkStay Bookings.lnk"',
      'RMDir /r "$SMPROGRAMS\\WA ParkStay Bookings"',
    ]);
    const install = macro('customInstall');
    const current = install.indexOf('SetShellVarContext current');
    const all = install.indexOf('SetShellVarContext all');
    expect(current).toBeGreaterThanOrEqual(0);
    expect(install[current + 1]).toBe('!insertmacro waStayRemoveLegacyShortcuts');
    expect(install[all + 1]).toBe('!insertmacro waStayRemoveLegacyShortcuts');
  });

  it('gives every MessageBox a silent-mode default (/SD)', () => {
    const boxes = CODE.filter((line) => /^MessageBox\b/i.test(line));
    expect(boxes.length).toBeGreaterThanOrEqual(3);
    for (const box of boxes) expect(box).toMatch(/\s\/SD ID(NO|OK|YES|CANCEL)\b/);
  });

  it('runs the uninstall data cleanup only when not updating, defaulting to No', () => {
    const uninstall = macro('customUnInstall');
    expect(uninstall[0]).toBe('${ifNot} ${isUpdated}');
    expect(closingEndIf(uninstall, 0)).toBe(uninstall.length - 1);

    const boxes = uninstall.filter((line) => line.startsWith('MessageBox'));
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      expect(box).toContain('MB_DEFBUTTON2');
      expect(box).toContain('/SD IDNO');
    }
  });

  it('deletes the WA Stay data and updater cache on "Yes"', () => {
    const uninstall = macro('customUnInstall');
    const yes = uninstall.indexOf('waStayDeleteData:');
    expect(uninstall.find((l) => l.startsWith('MessageBox'))).toContain('IDYES waStayDeleteData');
    expect(uninstall.slice(yes)).toEqual(
      expect.arrayContaining([
        'RMDir /r "$APPDATA\\WA Stay"',
        'RMDir /r "$LOCALAPPDATA\\wa-stay-updater"',
      ])
    );
    expect(uninstall.indexOf('RMDir /r "$APPDATA\\WA Stay"')).toBeGreaterThan(yes);
  });

  it('removes the v1.x data folder only inside the second prompt, which names it', () => {
    expect(
      CODE.filter((line) => line.includes('parkstay-bookings"') && /RMDir/i.test(line))
    ).toEqual([LEGACY_DATA_RMDIR]);

    const uninstall = macro('customUnInstall');
    const yes = uninstall.indexOf('waStayDeleteData:');
    const second = uninstall.findIndex(
      (line, i) =>
        i > yes && line.startsWith('MessageBox') && line.includes('$APPDATA\\parkstay-bookings')
    );
    const remove = uninstall.indexOf(LEGACY_DATA_RMDIR);
    expect(second).toBeGreaterThan(yes);
    // "No" (and the silent default) jumps past the removal
    expect(uninstall[second]).toMatch(/\/SD IDNO IDNO waStayDataDone$/);
    expect(remove).toBe(second + 1);
    expect(uninstall.indexOf('waStayDataDone:')).toBeGreaterThan(remove);

    // ...and only when that folder exists
    const branch = uninstall.findIndex((line) =>
      line.startsWith('${if} ${FileExists} "$APPDATA\\parkstay-bookings')
    );
    expect(branch).toBeGreaterThan(yes);
    expect(branch).toBeLessThan(second);
    expect(closingEndIf(uninstall, branch)).toBeGreaterThan(remove);
  });

  it('defines customCheckAppRunning: the usual check, then (installer only) close v1.x, then the snapshot', () => {
    const check = macro('customCheckAppRunning');
    // electron-builder 26's own check is IS_POWERSHELL_AVAILABLE, then _CHECK_APP_RUNNING, which
    // reads the variable the first sets
    expect(check).toEqual([
      '!insertmacro IS_POWERSHELL_AVAILABLE',
      '!insertmacro _CHECK_APP_RUNNING',
      '!ifndef BUILD_UNINSTALLER',
      '!insertmacro waStayCloseLegacyApp',
      '!insertmacro waStaySnapshotLegacyData',
      '!endif',
    ]);
    // electron-builder includes these only when customCheckAppRunning is not defined
    expect(CODE).toEqual(expect.arrayContaining(['!include "getProcessInfo.nsh"', 'Var pid']));
  });

  it("closes a running v1.x app (its own exe name) the way electron-builder closes WA Stay's", () => {
    // _CHECK_APP_RUNNING looks only for "WA Stay.exe"
    expect(CODE).toContain('!define WA_STAY_LEGACY_EXE "WA ParkStay Bookings.exe"');

    // Found by its exe name, as electron-builder 24's FIND_PROCESS did: electron-builder 26's
    // looks for any process under $INSTDIR, which an interactive upgrade nests in v1's folder
    expect(macro('waStayFindLegacyApp _RETURN')).toEqual([
      '!ifdef INSTALL_MODE_PER_ALL_USERS',
      '${nsProcess::FindProcess} "${WA_STAY_LEGACY_EXE}" ${_RETURN}',
      '!else',
      'nsExec::Exec `%SYSTEMROOT%\\System32\\cmd.exe /c tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${WA_STAY_LEGACY_EXE}" /FO csv | %SYSTEMROOT%\\System32\\find.exe "${WA_STAY_LEGACY_EXE}"`',
      'Pop ${_RETURN}',
      '!endif',
    ]);

    const close = macro('waStayCloseLegacyApp');
    expect(close.join('\n')).not.toContain('FIND_PROCESS');
    const find = close.indexOf('!insertmacro waStayFindLegacyApp $R0');
    expect(find).toBeGreaterThan(0);
    // An update waits for the app to exit by itself, then stops it without asking
    expect(close.slice(0, find)).toEqual(
      expect.arrayContaining(['${if} ${isUpdated}', 'Sleep 300'])
    );
    const prompt = close.findIndex((line) => line.startsWith('MessageBox MB_OKCANCEL'));
    const updateBranch = close.indexOf('${if} ${isUpdated}', find);
    expect(updateBranch).toBeGreaterThan(find);
    expect(close.slice(updateBranch, prompt)).toEqual([
      '${if} ${isUpdated}',
      'Sleep 1000',
      'Goto waStayLegacyStop',
      '${endIf}',
    ]);
    // Otherwise it asks first (OK in silent mode), and Cancel quits
    expect(close[prompt]).toMatch(
      /"WA ParkStay Bookings[^"]*is running\.[^"]*" \/SD IDOK IDOK waStayLegacyStop$/
    );
    expect(close[prompt + 1]).toBe('Quit');

    // Graceful taskkill first, then /f in a loop until the process is gone
    const kills = close.filter((line) => /taskkill/.test(line));
    expect(kills).toHaveLength(4); // per-machine and per-user variants of each
    for (const kill of kills) {
      expect(kill).toContain('/im "${WA_STAY_LEGACY_EXE}" /fi "PID ne $pid"');
    }
    const stop = close.indexOf('waStayLegacyStop:');
    const loop = close.indexOf('waStayLegacyLoop:');
    const closed = close.indexOf('waStayLegacyClosed:');
    expect(stop).toBeGreaterThan(prompt);
    const graceful = close.findIndex((line) => /taskkill \/im/.test(line));
    const forced = close.findIndex((line) => /taskkill \/f \/im/.test(line));
    expect(graceful).toBeGreaterThan(stop);
    expect(graceful).toBeLessThan(loop);
    expect(forced).toBeGreaterThan(loop);
    expect(forced).toBeLessThan(closed);
    expect(close.slice(loop)).toEqual(
      expect.arrayContaining([
        'Goto waStayLegacyClosed',
        'Goto waStayLegacyLoop',
        expect.stringMatching(
          /^MessageBox MB_RETRYCANCEL.*\/SD IDCANCEL IDRETRY waStayLegacyLoop$/
        ),
      ])
    );
    expect(closed).toBe(close.length - 2);
  });

  it('copies (never moves) the v1.x database, its -wal and -shm into legacy-snapshot, once; not the retired Gmail file', () => {
    const snapshot = macro('waStaySnapshotLegacyData');
    const guards = snapshot.filter((line) => /^\$\{(if|ifNot)\} \$\{FileExists\}/.test(line));
    expect(guards.slice(0, 3)).toEqual([
      '${if} ${FileExists} "$APPDATA\\parkstay-bookings\\parkstay.db"',
      '${ifNot} ${FileExists} "$APPDATA\\WA Stay\\migration.json"',
      '${ifNot} ${FileExists} "$APPDATA\\WA Stay\\legacy-snapshot\\parkstay.db"',
    ]);

    const copies = snapshot.filter((line) => line.startsWith('CopyFiles'));
    expect(copies).toEqual(
      ['parkstay.db', 'parkstay.db-wal', 'parkstay.db-shm'].map(
        (file) =>
          `CopyFiles /SILENT "$APPDATA\\parkstay-bookings\\${file}" "$APPDATA\\WA Stay\\legacy-snapshot"`
      )
    );
    expect(snapshot.join('\n')).not.toMatch(/gmail/i);
    // Copy only: nothing in the snapshot step moves or deletes a file
    expect(snapshot.join('\n')).not.toMatch(/\b(Rename|Delete|RMDir)\b/);
    // Every copy sits inside the three guards
    const outer = snapshot.indexOf(guards[0]);
    const inner = snapshot.indexOf(guards[2]);
    for (const copy of copies) {
      expect(snapshot.indexOf(copy)).toBeGreaterThan(inner);
      expect(snapshot.indexOf(copy)).toBeLessThan(closingEndIf(snapshot, inner));
    }
    expect(closingEndIf(snapshot, outer)).toBeGreaterThan(closingEndIf(snapshot, inner));
  });

  it('says WA Stay in its messages', () => {
    expect(macro('customInit').join('\n')).toContain('"WA Stay requires Windows 10 or later."');
  });

  it("keeps electron-builder's finish page (runAfterFinish) and defines no dead welcome text", () => {
    // A customFinishPage replaces the finish page; customHeader's welcome text had no page
    expect(() => macro('customFinishPage')).toThrow('defines no macro customFinishPage');
    expect(() => macro('customHeader')).toThrow('defines no macro customHeader');
    expect(CODE.join('\n')).not.toMatch(/MUI_FINISHPAGE|MUI_TEXT_WELCOME/);
    const builder = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron-builder.json'), 'utf8'));
    expect(builder.nsis.runAfterFinish).toBe(true);
  });
});
