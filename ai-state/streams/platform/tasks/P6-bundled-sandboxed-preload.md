# P6 — Bundled, sandboxed preload

**Stream:** platform · **Depends on:** P3

## Description
The preload is compiled by `tsc` as part of `tsconfig.main.json`, whose `include` lists `src/preload/**/*`. It is emitted to `dist/main/preload/index.js` and, at runtime, `require`s sibling files from `dist/main/shared/…`.

A sandboxed renderer's preload can only `require` `electron` (`contextBridge`, `ipcRenderer`, …), `events`, `timers` and `url`. That is why the main window runs with `sandbox: false` (`src/main/index.ts:59`), against architecture-notes §7.

Bundling the preload into one self-contained file lets the window run with `sandbox: true`. `esbuild` 0.21.5 is already installed, as a transitive dependency of Vite 5, so no new dependency is needed.

## Size
M

## Scope
- **`scripts/build-preload.mjs`** uses the esbuild API.
  - It exports `preloadBuildOptions` so tests can reuse them.
  - Options: `entryPoints: ['src/preload/index.ts']`, `outfile: 'dist/preload/index.js'`, `bundle: true`, `format: 'cjs'`, `platform: 'browser'`, `target: 'chrome120'` (Electron 28.3.3 ships Chromium 120), `external: ['electron']`, `sourcemap: 'linked'`, `metafile: true`. `tsconfig` paths such as `@shared/*` resolve through esbuild's tsconfig support.
  - After building, it reads the metafile and **fails the build if the output imports anything other than `electron`**.
  - `--watch` mode is used for development.
- **`package.json` scripts**
  - Add `build:preload`.
  - `build` becomes `build:main && build:preload && build:renderer`.
  - `dev` also runs `dev:preload` (watch).
- **`tsconfig.main.json`** removes `src/preload/**/*` from `include`, so `tsc` no longer emits a preload. `npm run type-check` still covers the preload through the root `tsconfig.json`, whose `include` has `src/preload/**/*`.
- **Main window** (`src/main/app/main-window.ts`, from P4; if P4 has not merged yet, use the window code in `index.ts`):
  - The preload path becomes `path.join(__dirname, '../../preload/index.js')`, resolved from `dist/main/main/`.
  - Set `sandbox: true`, keeping `contextIsolation: true` and `nodeIntegration: false`.
  - If the preload file is missing, log and show a clear error instead of a blank window.
- **Preload clean-up.** Remove the `console.log` lines at `src/preload/index.ts:372-374`. The preload must not reference `process.env` or Node built-ins.
- **Packaging.** `electron-builder.json` `files` (`"dist/**/*"`) already includes `dist/preload/`. Confirm that `npm run clean` removes stale `dist/main/preload/` output.
- **Docs.** Add a short "Build pipeline" note to `docs/development.md` covering the main (tsc), preload (esbuild) and renderer (Vite) builds.

## Non-goals
- Provider sign-in and payment windows. They have no preload by design (§7, V6).
- Changes to the IPC contract or the shape of `window.api` (P3).
- CSP or window guards (P4).
- Upgrading Electron (OPEN-QUESTIONS Q1).
- The Electron smoke E2E suite (Q1). This task adds only the targeted checks below.

## Completion Criteria
- [ ] `npm run clean && npm run build` produces a single file, `dist/preload/index.js`, and no `dist/main/preload/` directory.
- [ ] A unit test of the metafile check rejects an output that imports `fs`, and accepts one that imports only `electron`.
- [ ] A Jest test bundles `src/preload/index.ts` in memory (`write: false`, same options) and evaluates it in a `vm` context whose `require` serves only `{ electron: fake }`. It asserts that:
  - `contextBridge.exposeInMainWorld('api', …)` is called once;
  - every `WindowApi` contract method exists;
  - `api.watches.list()` calls `ipcRenderer.invoke('watches:list', …)`.
- [ ] `grep -c "ZodError" dist/preload/index.js` prints `0`, so the preload bundles channel names only.
- [ ] A unit test with a mocked `BrowserWindow` shows `webPreferences` includes `{ sandbox: true, contextIsolation: true, nodeIntegration: false }`.
- [ ] Runtime check, using `npm run build && xvfb-run -a npx electron . --no-sandbox` with the Electron-ABI binary from `ai-state/RUNBOOK.md`:
  - the window loads and `window.api` is defined;
  - `typeof window.require` and `typeof window.process` are both `'undefined'`;
  - the main process logs `webContents.getLastWebPreferences().sandbox === true`;
  - the Watches page lists watches;
  - there are no preload errors in the log.
- [ ] Running `npm run dev` and then editing `src/preload/index.ts` rewrites `dist/preload/index.js` within 2 s.
- [ ] `npm run pack` produces an `app.asar` containing `dist/preload/index.js`. Check with `npx asar list release/*-unpacked/resources/app.asar | grep dist/preload/index.js`.
- [ ] `npm run lint && npm run format:check && npm run type-check && npm test` pass.

## Edge Cases
- **Limited globals.** The sandboxed preload only has `Buffer`, `process` (limited), timers and `URL`. Any accidental import of `path`, `fs` or a Node-only dependency must fail the build, not the app at runtime.
- **Two different sandboxes.** The `--no-sandbox` CLI flag, needed when running as root in CI or containers, disables the OS-level Chromium sandbox only. It does not change the `sandbox: true` webPreference. Verify the sandboxed-preload semantics (`require('fs')` unavailable) separately.
- **Start-up ordering in dev.** If `npm start` runs before the first preload build has finished, the app must show the clear "preload missing" error rather than hang.
- **Paths.** Packaged builds load from inside `app.asar`, so the preload path must be built from `__dirname`, never from `process.cwd()`. Windows backslashes must work.
- **Source maps.** `.gitignore` already ignores `*.js.map`. Shipping maps in the package is acceptable.
- **Stale output.** An older `dist/main/preload/index.js` left over from earlier builds must not be loaded. The new path points at `dist/preload/`.

## Test Strategy
- **Unit:** about 6 tests.
  - Metafile import check (2).
  - In-memory bundle evaluated in a `vm` (3).
  - `webPreferences` assertion (1).
- **Component:** none.
- **Integration:** none in Jest. The runtime check under xvfb and the `asar` listing above cover packaging. Q1 later adds a Playwright `_electron` smoke test against the same build.

## Context Files to Read First
- `ai-state/architecture-notes.md` §1 (`preload/`), §7 and §10 (Electron 28 / Node 18). `ai-state/RUNBOOK.md`.
- `src/preload/index.ts`, `src/preload/window.d.ts` and `src/shared/contracts/index.ts` (from P3)
- `src/main/app/main-window.ts` (from P4), or `src/main/index.ts:44-101` if P4 has not merged
- `package.json` scripts, `tsconfig.json`, `tsconfig.main.json`, `vite.config.ts` and `electron-builder.json` (`files`)
- `node_modules/esbuild/lib/main.d.ts` (`BuildOptions`, `Metafile`)

## Notes
- Electron's sandboxed-preload rules are documented at <https://www.electronjs.org/docs/latest/tutorial/sandbox#preload-scripts>.
- Merge after P4 if possible. Both tasks edit `main-window.ts` and `package.json` scripts.
- Keep the bundle small. If it is above about 50 KB, check whether shared modules pulled in zod or other runtime code by accident.
