/**
 * Opt-in smoke test of browser automation on a REAL browser (V7). Skipped unless
 * `WA_STAY_BROWSER_E2E=1`:
 *
 *   WA_STAY_BROWSER_E2E=1 npx jest tests/integration/browser-automation.smoke.test.ts
 *
 * It launches the installed Chrome or Edge headless (real `playwright-core`, no mocks) on a
 * throwaway profile, and drives the browser-driven FakeProvider against the fake holiday-park
 * site served on loopback HTTP. Set `WA_STAY_BROWSER_PATH` to automate a specific Chromium
 * build instead of detecting Edge or Chrome, e.g. on Linux CI:
 *
 *   WA_STAY_BROWSER_E2E=1 WA_STAY_BROWSER_PATH=/opt/pw-browsers/chromium \
 *     npx jest tests/integration/browser-automation.smoke.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createProviderContext,
  FakeSecretVault,
  InMemoryKeyValueStore,
  NodeHttpClient,
  type AccommodationProvider,
  type ProviderContext,
} from '@main/providers/sdk';
import { startFakeSiteServer } from '@tests/fixtures/fake-browser-site';
import { createFakeBrowserProviderFactory } from '@tests/utils/fake-browser-provider';
import { createMemoryLogger } from '@tests/utils/fake-provider';

const enabled = process.env.WA_STAY_BROWSER_E2E === '1';

(enabled ? describe : describe.skip)('browser automation on a real browser (smoke)', () => {
  let site: Awaited<ReturnType<typeof startFakeSiteServer>>;
  let dataDir: string;
  let ctx: ProviderContext;
  let provider: AccommodationProvider;
  const logger = createMemoryLogger();

  beforeAll(async () => {
    site = await startFakeSiteServer();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-browser-smoke-'));
    const factory = createFakeBrowserProviderFactory({ baseUrl: site.baseUrl });
    ctx = createProviderContext(factory.manifest, {
      createHttp: (providerId) => new NodeHttpClient({ providerId }),
      createState: () => new InMemoryKeyValueStore(),
      vault: new FakeSecretVault(),
      logger,
      providersDir: path.join(dataDir, 'providers'),
      browserExecutablePath: process.env.WA_STAY_BROWSER_PATH,
    });
    provider = factory(ctx);
  });

  afterAll(async () => {
    await ctx?.browser.close();
    await site?.close();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('finds a browser to automate', async () => {
    const availability = await ctx.browser.isAvailable();
    expect(availability).toMatchObject({ available: true });
    console.info(`Automating ${availability.channel}`);
  });

  it('opens a loopback page and reads its title', async () => {
    const title = await ctx.browser.withPage(async (page) => {
      await page.goto(`${site.baseUrl}/parks`);
      return page.title();
    });
    expect(title).toBe('Fake Holiday Parks: all parks');
  });

  it('reads one location through the provider', async () => {
    const [first] = await provider.catalog!.listLocations!();
    expect(first).toMatchObject({
      key: 'fake-browser:swan-valley',
      name: 'Swan Valley Holiday Park',
      kind: 'holiday-park',
      lat: -31.8481,
    });
  });

  it('checks availability for that location', async () => {
    const result = await provider.availability!.check('swan-valley', {
      arrival: '2026-11-13',
      departure: '2026-11-15',
      adults: 2,
    });
    expect(result.units[0]).toMatchObject({ unitId: 'c1', fullyAvailable: true, total: 290 });
  });

  it('keeps the profile at providers/<id>/browser and leaves no page open', async () => {
    expect(fs.existsSync(path.join(dataDir, 'providers', 'fake-browser', 'browser'))).toBe(true);
    const pages = await ctx.browser.withPage(async (page) => page.context().pages().length);
    expect(pages).toBe(1); // only this call's page
  });

  it('closes, and then refuses new work', async () => {
    await ctx.browser.close();
    await expect(ctx.browser.withPage(async () => undefined)).rejects.toMatchObject({
      reason: 'closing',
    });
  });
});
