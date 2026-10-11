/**
 * Preview a provider in the app (opt-in): `PREVIEW_PROVIDER` names it by id.
 *
 *   npm run build:e2e
 *   npx cross-env PREVIEW_PROVIDER=acme-parks playwright test preview-provider
 *   # Linux without a display: xvfb-run -a npx cross-env PREVIEW_PROVIDER=acme-parks playwright test preview-provider
 *   # Dates your recorded responses cover: add PREVIEW_ARRIVAL=2026-11-10 (two nights from then)
 *
 * It launches the built app as every journey does (network-free fixture mode, a temp profile)
 * with only that provider registered, and checks that:
 * - Explore lists its places;
 * - with dates (two nights from `PREVIEW_ARRIVAL`, by default tomorrow in the provider's time
 *   zone, set through Explore's address), Explore shows the provider's free counts without an
 *   error, when it has `bulkAvailability`;
 * - the first place's page opens with those dates, and "Check availability" answers with the
 *   night grid, or "No … were listed for these dates", not an error. If the provider's
 *   responses say nothing about any night of the stay (every night reads Unknown), the test
 *   passes with a warning annotation, logged too: set `PREVIEW_ARRIVAL` to dates they cover;
 * - Settings → Accounts shows it;
 * - fixture mode refused no request (a missing route, such as the signed-in check's), and the
 *   window logged no errors.
 * Each step's screenshot is attached to the report (`npx playwright show-report`) and saved
 * under `test-results/`. A step that fails quotes what the app logged about the provider.
 *
 * In fixture mode the provider's HTTP answers from `tests/e2e/fixtures/http/<id>/`, whatever
 * host it asks. Browser automation (`ctx.browser`) is not served from fixtures: preview a
 * browser provider by hand ("Preview in the app" in docs/providers/browser-providers.md).
 *
 * Without `PREVIEW_PROVIDER` the test is skipped, so the suite and CI never run it.
 */

import type { Page, TestInfo } from '@playwright/test';
import { stayRangeLabel } from '../../src/renderer/components/nightGridModel';
import type { ProviderManifest } from '../../src/shared/types/provider.types';
import { addDays, isCalendarDate, todayIn } from '../../src/shared/utils/calendar-date';
import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';
import { chooseAccountMenuItem, currentRoute, pageHeading } from './support/shell';

const PROVIDER = process.env.PREVIEW_PROVIDER?.trim() ?? '';
/** The stay's first night, `YYYY-MM-DD`; by default tomorrow in the provider's time zone. */
const ARRIVAL = process.env.PREVIEW_ARRIVAL?.trim() ?? '';

/** How long a catalogue may take to show: the app syncs it 5 s after the window is up. */
const CATALOGUE_TIMEOUT_MS = 30_000;
/** How long availability may take: the core gives a provider 20 s, plus the page's own work. */
const AVAILABILITY_TIMEOUT_MS = 30_000;

async function screenshot(window: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`);
  await window.screenshot({ path: file, fullPage: true });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

/** The lines of the app's log that mention `id`, for a failure message. */
function linesAbout(log: string, id: string): string {
  const lines = log.split(/\r?\n/).filter((line) => line.includes(id));
  return lines.length > 0 ? lines.slice(-20).join('\n') : '(nothing)';
}

/** An in-app (hash) navigation, as a link in the app makes: no reload. */
async function go(window: Page, route: string): Promise<void> {
  await window.evaluate((hash) => {
    location.hash = hash;
  }, `#${route}`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The provider's manifest, as the app's own renderer reads it (`providers.list()`). */
async function manifestOf(window: Page, id: string): Promise<ProviderManifest> {
  const answer = await window.evaluate(() => {
    const { api } = globalThis as unknown as {
      api: { providers: { list(): Promise<{ success: boolean; data?: unknown; error?: string }> } };
    };
    return api.providers.list();
  });
  const manifest = answer.success
    ? (answer.data as ProviderManifest[]).find((m) => m.id === id)
    : undefined;
  if (!manifest) throw new Error(`The app lists no provider ${id}: ${answer.error ?? 'not found'}`);
  return manifest;
}

test.describe('preview a provider', () => {
  test.skip(!PROVIDER, 'Set PREVIEW_PROVIDER=<provider id> to preview a provider in the app');

  test('the provider on Explore and a place page, with dates, and in Settings', async ({
    launchWaStay,
  }, testInfo) => {
    test.setTimeout(180_000);
    const wa = await launchWaStay({ providers: [PROVIDER] });
    const { window } = wa;
    /** Runs a step; if it fails, the error says what the app logged about the provider. */
    const step = async (what: string, run: () => Promise<void>, shot: string): Promise<void> => {
      try {
        await run();
      } catch (error) {
        await screenshot(window, testInfo, shot);
        throw new Error(
          `${what}. What the app logged about ${PROVIDER}:\n${linesAbout(wa.mainLog(), PROVIDER)}`,
          { cause: error }
        );
      }
    };

    // Explore: with only this provider registered, every place listed is its own.
    const results = window.getByRole('region', { name: 'Results' });
    const count = results.getByRole('heading', { level: 2, name: /^[1-9][\d,]* places?$/ });
    await step(
      `Explore shows no places from ${PROVIDER} after ${CATALOGUE_TIMEOUT_MS / 1000} s`,
      () => expect(count).toBeVisible({ timeout: CATALOGUE_TIMEOUT_MS }),
      'explore'
    );
    await screenshot(window, testInfo, 'explore');

    // Dates: tomorrow in the provider's time zone, for two nights, as a link to Explore sets them.
    const manifest = await manifestOf(window, PROVIDER);
    const { capabilities, shortName } = manifest;
    const today = todayIn(manifest.timezone);
    if (ARRIVAL && !(isCalendarDate(ARRIVAL) && ARRIVAL >= today)) {
      throw new Error(
        `PREVIEW_ARRIVAL must be a date (YYYY-MM-DD) from today (${today} in ${manifest.timezone}) on, not "${ARRIVAL}"`
      );
    }
    const arrival = ARRIVAL || addDays(today, 1);
    const departure = addDays(arrival, 2);
    const range = stayRangeLabel(arrival, departure);
    const stay = `arrival=${arrival}&departure=${departure}`;
    await go(window, `/?${stay}`);
    const bulkFailed = window.getByText(`Couldn't check availability on ${shortName}.`);
    if (capabilities.bulkAvailability) {
      // "5 places · 2 available for 11–13 Oct": the provider's bulk availability answered.
      const counted = results.getByRole('heading', {
        level: 2,
        name: new RegExp(`^[\\d,]+ places? · [\\d,]+ available for ${escapeRegExp(range)}$`),
      });
      await step(
        `Explore shows no availability from ${PROVIDER} for ${range}`,
        async () => {
          await expect(counted.or(bulkFailed)).toBeVisible({ timeout: AVAILABILITY_TIMEOUT_MS });
          await expect(bulkFailed).toHaveCount(0);
        },
        'explore-dates'
      );
    } else {
      // No bulk availability: Explore lists the places with dates, and asks nothing for them.
      await expect(
        results.getByRole('heading', { level: 2, name: /^[1-9][\d,]* places?$/ })
      ).toBeVisible();
    }
    await screenshot(window, testInfo, 'explore-dates');

    // The first place's page, with the same dates: its detail and availability come from the
    // provider.
    await results.getByRole('link').first().click();
    await expect
      .poll(() => currentRoute(window))
      .toMatch(new RegExp(`^/places/${PROVIDER}/[^?]+\\?${escapeRegExp(stay)}`));
    await expect(pageHeading(window)).toBeVisible();
    const stayCard = window.getByRole('region', { name: 'Check your dates' });
    if (capabilities.availability) {
      const check = stayCard.getByRole('button', { name: 'Check availability' });
      await step(
        `The first place's page offers no "Check availability" (does its detail list units?)`,
        () => expect(check).toBeVisible({ timeout: AVAILABILITY_TIMEOUT_MS }),
        'place'
      );
      await check.click();
      // The night grid: its "Fully available only" switch once the provider listed units, or
      // "No sites were listed for these dates".
      const answered = window.getByRole('region', { name: 'Availability', exact: true });
      const fullyOnly = answered.getByRole('switch', { name: 'Fully available only' });
      const noUnits = answered.getByText(/^No .+ were listed for these dates$/);
      const failed = stayCard
        .getByRole('alert')
        .or(stayCard.getByText(/waiting queue right now|Too many checks/));
      await step(
        `"Check availability" on the first place's page gave no answer for ${range}`,
        async () => {
          await expect(fullyOnly.or(noUnits).or(failed)).toBeVisible({
            timeout: AVAILABILITY_TIMEOUT_MS,
          });
          await expect(failed).toHaveCount(0);
        },
        'place'
      );
      if (await fullyOnly.isVisible()) {
        // Every unit's nights, as the provider reported them, not only the fully available.
        if (await fullyOnly.isChecked()) await fullyOnly.click();
        await expect(
          answered.getByRole('table', { name: `Availability by night, ${range}` })
        ).toBeVisible();
        // An answer, but about none of the stay's nights: say so, without failing the preview
        // (a generated provider's sample responses cover only their own dates).
        const noKnownNight = `${shortName} didn't say which nights are free; check on ${shortName}`;
        if (await answered.getByText(noKnownNight, { exact: true }).isVisible()) {
          const warning =
            `Every night of ${arrival} to ${departure} reads Unknown: ${PROVIDER}'s responses ` +
            `in tests/e2e/fixtures/http/${PROVIDER}/ don't cover those dates. Set ` +
            'PREVIEW_ARRIVAL=YYYY-MM-DD to dates they cover to see its nights.';
          testInfo.annotations.push({ type: 'warning', description: warning });
          console.warn(`Warning: ${warning}`);
        }
      }
    } else {
      await expect(
        stayCard.getByText(`${shortName} doesn't share availability with WA Stay`, { exact: false })
      ).toBeVisible();
    }
    await screenshot(window, testInfo, 'place');

    // Settings → Accounts: a row for every provider.
    await chooseAccountMenuItem(window, 'Settings');
    await expect(window.getByRole('heading', { name: 'Accounts' })).toBeVisible();
    await screenshot(window, testInfo, 'settings-accounts');

    // Nothing fixture mode had no route for (the photos it never loads aside), such as a
    // signed-in check with no route in tests/e2e/fixtures/http/<id>/manifest.json.
    const requests = wa.unexpectedRequests();
    expect(
      withoutRemoteImages(requests),
      `Requests with no route: add them to tests/e2e/fixtures/http/${PROVIDER}/manifest.json`
    ).toEqual([]);
    expect(withoutGuardedRequests(await wa.consoleErrors(), requests)).toEqual([]);
  });
});
