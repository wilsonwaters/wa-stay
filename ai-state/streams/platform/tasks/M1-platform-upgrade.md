# M1 — Platform upgrade: Node 24, Electron latest, better-sqlite3 latest, packaged hardening, differential updates

## Description
The stakeholder develops on Windows with Node 24. better-sqlite3 9.6 does not compile on Node 24
(V8 API changes), and Electron 28 is long out of support. Bring the runtime platform to current
versions so `npm ci && npm run dev` works on Node 24 (Windows, macOS, Linux), CI runs on Node 24,
and the shipped app runs on the latest Electron. In the same task, harden the packaged app (the
final review's suggestions) and make updates download only the changed blocks.

Stakeholder decisions (2026-10-10): upgrade to the latest frameworks and libraries; Node 24 for
development and CI; Electron fuses and a permission handler; update vulnerable dependencies; smaller
update downloads.

## Size
L (no design round: the target versions are given and the behaviour must not change).

## Scope
1. **Node 24.** `engines.node` `>=24`; add `.nvmrc` (`24`). Every `node-version` in
   `.github/workflows/ci.yml` and `build.yml` becomes `24.x`. `actions/checkout@v4` → `@v5` and
   `actions/setup-node@v4` → `@v5` (both run on Node 24). Leave the other actions' majors alone
   unless you can show a newer major exists and is needed.
2. **Electron latest** (44.x at the time of writing: `npm view electron dist-tags.latest`).
   - Work through the Electron breaking changes from 29 to the target major (electronjs.org
     "Breaking Changes"), and fix every use in `src/main/**` and `src/preload/**`.
     Likely areas include:
     - `File.path` (removed);
     - `protocol.registerFileProtocol` (deprecated in favour of `protocol.handle`);
     - `webContents` `console-message` event arguments;
     - `session` preload APIs;
     - `BrowserWindow`/`WebContentsView`;
     - `net` and `session.fetch`;
     - `app.setLoginItemSettings` on Windows;
     - `safeStorage`;
     - `nativeTheme`;
     - `systemPreferences`;
     - `webFrame`.
   - `electron-builder.json`: drop the stale `"electronVersion": "28.0.0"` pin (or set it to the
     installed version).
   - `@types/node` matches the Node major bundled by the new Electron.
   - The CSP, the sender guard, the window and navigation guards, provider windows and the
     sandboxed preload must behave exactly as before. Their tests must stay green unchanged,
     unless an Electron API change forces a test change; explain any such change.
3. **better-sqlite3 latest** (13.x, needs Node >= 22) and `@types/better-sqlite3` to match.
   - It must build for both Node 24 (Jest) and the new Electron (the app):
     - `npm rebuild better-sqlite3` for Node;
     - `npm run rebuild` / electron-builder `install-app-deps` for Electron.
   - Keep `scripts/check-native-abi.js` working and update `native.sh` users' expectations in
     `docs/development.md` if commands change.
   - All database code, every migration test and the v5/v6 upgrade fixtures must pass unchanged.
     The SQLite version bump must not change FTS5 behaviour or `secure_delete`/VACUUM.
4. **electron-builder 26** and **electron-updater** latest 6.x.
   - Installer behaviour must be unchanged. `resources/installer.nsh` macros (`customInit`,
     `customInstall`, `customUnInstall`, `${isUpdated}`) must still be invoked.
   - Check the electron-builder 25/26 changelogs for NSIS macro or option changes.
   - `appId`, `productName`, `artifactName`s and `publish` stay as they are.
5. **Packaged hardening (Electron fuses).** Add `@electron/fuses` and flip the fuses at package
   time, through electron-builder's own `electronFuses` config if v26 supports it, otherwise in an
   `afterPack` hook:
   - `RunAsNode` off;
   - `EnableNodeOptionsEnvironmentVariable` off;
   - `EnableNodeCliInspectArguments` off;
   - `OnlyLoadAppFromAsar` on;
   - `EnableCookieEncryption` on;
   - `EnableEmbeddedAsarIntegrityValidation` on, only if electron-builder writes the asar integrity
     for the targets we ship; otherwise leave it off and say why.

   Requirements:
   - `npm run smoke:packaged` must still pass.
   - Extend it to read the packaged binary's fuse wire (`@electron/fuses` `getCurrentFuseWire`) and
     assert each value.
   - Update `docs/security.md`.
6. **Permission handler on the main window's session.**
   - `session.defaultSession` (and the main window's session if different) gets a
     `setPermissionRequestHandler` that denies everything and a `setPermissionCheckHandler` that
     returns false. The exception is any permission the app genuinely uses; grep first, since
     notifications are shown from main, not the renderer.
   - Provider windows already refuse permissions; keep that.
   - Add tests next to the existing window-guard tests.
7. **Differential updates.** NSIS `differentialPackage` is already on, so electron-builder writes
   `release/*.exe.blockmap`, but `build.yml` uploads only `release/*.exe` and `release/latest.yml`.
   - Upload `release/*.blockmap` too, so the draft release carries them and electron-updater
     downloads only changed blocks.
   - Check that `latest.yml` references the blockmap as electron-updater expects.
   - Document this in `docs/release-process.md`: the blockmap must be attached to every release.
     The first update from 1.2.0 downloads in full, because 1.2.0's release had no blockmap.
8. **Production dependencies with known vulnerabilities.**
   - Bump to the latest versions:
     - `nodemailer` (10.x: check its breaking changes against `email-smtp.notifier.ts`);
     - `sanitize-html`;
     - `winston`;
     - `electron-log`;
     - `playwright-core` (and `@playwright/test`, same version);
     - `axios` (dev only).
   - Move `axios` and `tsconfig-paths` to `devDependencies`. Prove nothing in `dist/` requires them:
     grep the built main bundle.
   - Then `npm audit --omit=dev` must report **0 high and 0 critical**, or every remaining entry
     must be listed with why it is unreachable or unfixable.
9. Docs: update the version facts in `CLAUDE.md`, `docs/development.md` and `README.md`
   prerequisites:
   - Electron version, Node 24;
   - native module rebuild commands;
   - the Tech Stack table.

## Non-goals
- React, React Router, Tailwind, zod, react-hook-form, React Query, testing-library: task M2 does
  these in parallel on another lane.
- TypeScript, Vite, Jest, ESLint, Prettier and other build tooling: task M3, after M1 and M2.
- No feature or UI changes.

## Completion Criteria
- [ ] On Node 24, these pass:
  - `npm ci`;
  - `npm run lint` (0 errors), `npm run format:check` and `npm run type-check`;
  - `npm test` (all pass) and `npm run test:tz`.
- [ ] On the new Electron, `npm run build:e2e && xvfb-run -a npm run test:e2e` passes, and so do
  `npm run test:electron` and `npm run smoke:packaged`.
- [ ] `node -p "require('./package.json').engines.node"` is `>=24`; `.nvmrc` says 24; the workflows
  use Node 24.x with checkout and setup-node at v5.
- [ ] The packaged app's fuses read back as specified (smoke test asserts them).
- [ ] The main session denies permission requests and checks (tests).
- [ ] `build.yml` uploads `release/*.blockmap`; docs say why.
- [ ] `npm audit --omit=dev`: 0 high and 0 critical, or each remaining entry is justified in the
  task report.
- [ ] `axios` and `tsconfig-paths` are dev dependencies; the built main bundle does not require
  them.
- [ ] No behaviour change: the full e2e suite, the migration tests and the provider-window tests
  pass.

## Edge Cases
- Prebuilt better-sqlite3 binaries may be missing for the newest Electron. electron-builder then
  builds from source (CI has the toolchains). Say what happens in CI on Windows.
- Electron's own Node version may be older or newer than 24. Jest runs on system Node, the app on
  Electron's Node: both builds of better-sqlite3 must exist at the right time (`npm run rebuild`).
- Playwright's `_electron` must support the new Electron major. Use the matching
  `@playwright/test`.

## Test Strategy
- Existing suites are the regression net.
- Add tests only for the permission handler and the fuse assertions.

## Context Files to Read First
- `CLAUDE.md`
- `package.json`, `electron-builder.json`, `.github/workflows/*.yml`
- `scripts/check-native-abi.js`, `scripts/packaged-smoke.js`
- `src/main/index.ts`, `src/main/app/*.ts`, `src/preload/index.ts`
- `resources/installer.nsh`
- `docs/security.md`, `docs/development.md`, `docs/release-process.md`
