# Runbook — local dev environment

## Sandbox setup (cloud container, Project 2)
```bash
# The container's default Node is 22; the project needs 24 (.nvmrc).
export NVM_DIR=/opt/nvm; . /opt/nvm/nvm.sh; nvm install 24
for b in node npm npx corepack; do ln -sf /opt/nvm/versions/node/v24.*/bin/$b /root/.local/bin/$b; done
npm ci
npx install-electron --no     # npm ci does not download Electron's binary (Electron 42+)
```

## Pre-commit gate
```bash
npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz
npm run build:e2e && xvfb-run -a npm run test:e2e     # renderer, IPC or e2e changes
```
Baseline on `4bd5d62` (2026-10-16): lint 0 errors (37 warnings); 4081 tests (6 skipped); `test:tz` 7; e2e 22 passed, 2 opt-in skipped.

## Native module
better-sqlite3 13 ships one Node-API binary for Node and Electron: nothing is rebuilt (`scripts/check-native-abi.js` checks it loads).

## Parallel lanes
Implementation agents work in their own git worktrees under `/home/user/lanes/<id>` on branch `lane/<id>`, cut from `ccr-573ddb1d-hir0sq`. A worktree shares the main checkout's `node_modules` through a symlink (`ln -s /home/user/wa-stay/node_modules node_modules`). The orchestrator merges each reviewed lane into `ccr-573ddb1d-hir0sq`.

## Running the app headless
```bash
npm run build
xvfb-run -a npx electron . --no-sandbox
```
Runtime verification uses Playwright's `_electron` against the built app (`tests/e2e/`). For Mapbox GL under xvfb, launch with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` (test-launch args only).

## Mapbox
Copy `.env.example` → `.env` and set `MAPBOX_ACCESS_TOKEN=pk....` (gitignored). CI reads the `MAPBOX_ACCESS_TOKEN` secret. The e2e build has no token.
