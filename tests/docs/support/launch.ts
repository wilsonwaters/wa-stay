/**
 * Launches the built app for the documentation screenshots (`npm run docs:screenshots`).
 *
 * It follows the Electron smoke-test harness (`tests/e2e/support/wa-stay.ts`): a temp userData
 * (`WA_STAY_USER_DATA_DIR`, checked before anything else), network-free fixture mode
 * (`WA_STAY_E2E_FIXTURES_DIR`, the same recorded ParkStay responses), ParkStay alone
 * (`WA_STAY_PROVIDERS`), a production build, Perth time, Australian English and a window forced
 * online. Two things differ, which the harness cannot do yet (it takes no launch arguments):
 *
 * - **The map.** With a Mapbox token in the build, Mapbox's API host is let through the network
 *   guard (`WA_STAY_E2E_ALLOW_HOSTS`); nothing else leaves the machine. Without a token Explore is
 *   list-only and the run is entirely network-free.
 * - **Software GL on Linux.** Under xvfb, Electron 28's default GL crashes the renderer on a
 *   Mapbox page (ai-state/RUNBOOK.md), so Linux runs get SwiftShader. Launch arguments only,
 *   never app code; Windows and macOS use their GPU.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { HTTP_FIXTURES_DIR, REPO_ROOT } from '../../e2e/support/paths';

/**
 * The only host a run with a Mapbox token reaches: Mapbox's API (styles, tiles, glyphs,
 * sprites; telemetry stays blocked). Provider photos stay blocked on purpose: they are the
 * provider's (DBCA's) images, shown live in the app and never copied into the repository
 * (brief O8), so the cards show the photo placeholder.
 */
export const MAPBOX_HOSTS = ['api.mapbox.com'];

export interface DocsApp {
  app: ElectronApplication;
  window: Page;
  close(): Promise<void>;
}

/**
 * Makes the window report itself online whatever the host's network, as the harness's
 * `forceOnline` does: Explore turns availability off in a window that reads offline.
 */
async function forceOnline(window: Page): Promise<void> {
  const cdp = await window.context().newCDPSession(window);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
}

function launchEnv(userDataDir: string, map: boolean): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (name === 'ELECTRON_RENDERER_URL' || name === 'ELECTRON_RUN_AS_NODE') continue;
    if (name.startsWith('WA_STAY_')) continue;
    env[name] = value;
  }
  return {
    ...env,
    NODE_ENV: 'production',
    TZ: 'Australia/Perth',
    LANG: 'en_AU.UTF-8',
    WA_STAY_USER_DATA_DIR: userDataDir,
    WA_STAY_E2E_FIXTURES_DIR: HTTP_FIXTURES_DIR,
    // The images show ParkStay's fixture, however many providers are built in
    WA_STAY_PROVIDERS: 'parkstay',
    ...(map ? { WA_STAY_E2E_ALLOW_HOSTS: MAPBOX_HOSTS.join(',') } : {}),
  };
}

export async function launchForDocs({ map }: { map: boolean }): Promise<DocsApp> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-docs-'));
  const linux = process.platform === 'linux';
  const app = await electron.launch({
    args: [
      REPO_ROOT,
      ...(linux
        ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        : []),
      ...(linux && process.env.CI ? ['--no-sandbox'] : []),
    ],
    cwd: REPO_ROOT,
    env: launchEnv(userDataDir, map),
  });
  const close = async (): Promise<void> => {
    await app.close().catch(() => app.process().kill('SIGKILL'));
    fs.rmSync(userDataDir, { recursive: true, force: true });
  };
  try {
    // Never photograph a real profile.
    const actual = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    if (actual !== userDataDir)
      throw new Error(`The app uses userData ${actual}, not ${userDataDir}`);
    const window = await app.firstWindow();
    await forceOnline(window);
    // A fixed size, so the images are the same from run to run.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 800);
    });
    await window.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30_000 });
    return { app, window, close };
  } catch (error) {
    await close();
    throw error;
  }
}
