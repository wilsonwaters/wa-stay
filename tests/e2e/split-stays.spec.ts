/**
 * Split stays (architecture-notes §12.36), network-free: a stay free every night, but only by
 * moving between units, shown for what it is and never as available. Each journey edits its own
 * dated copy of the fixtures (`support/dated-fixtures.ts`, `editDatedFixture`); the recorded
 * fixtures have no split stay, so every other journey is unaffected: no RAC category is free
 * every night without a site for the whole stay, and Bungarra's free sites are free for both
 * nights.
 *
 * 1. **RAC, booked through the park.** RAC Busselton Holiday Park's answer is edited so its
 *    Powered Site (the only category free every night) keeps its free sites each night but has
 *    none for the whole stay (stay-through 0, code 3), as RAC answers when a stay would have to
 *    move between sites. With ParkStay and RAC and dates set, Busselton's card reads "Free if
 *    you move sites", after the places with something free and before "None free", and
 *    "Available only" hides it. Its page's check shows the block: "Free if you move sites", the
 *    Powered Site at about its nightly rates, and "Contact RAC Busselton Holiday Park", a link to
 *    the park's contact page that is never followed. A prefilled watch with "Alert on stays that
 *    move between sites" ticked finds it on "Check now": the result line, the same block and
 *    link, and the bell's split alert, which opens the watch.
 * 2. **ParkStay, booked part by part.** Bungarra's view is edited so CAMPSITE 03 is free on the
 *    first night only, CAMPSITE 04 on the second only, and CAMPSITE 05 on neither. Its page's
 *    check shows "Free if you move sites", "Across 2 sites", the two parts in order, and a "Book
 *    {range} on ParkStay" link per part, ParkStay's own search page with that part's dates.
 *
 * Fixture mode refuses no request but the photos, which it never loads; no link is followed;
 * nothing is held. Roles and accessible names only.
 */

import type { Locator } from '@playwright/test';
import { stayRangeLabel } from '../../src/renderer/components/nightGridModel';
import { addDays } from '../../src/shared/utils/calendar-date';
import { editDatedFixture, writeDatedFixtures } from './support/dated-fixtures';
import {
  currentRoute,
  expectCurrentStep,
  expectHeadingFocused,
  expectRoute,
} from './support/shell';
import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';

/** The catalogues sync 5 s after launch (V5); give them room on a slow runner. */
const CATALOGUE_TIMEOUT_MS = 30_000;
/** ParkStay's 11 campgrounds and RAC's 8 parks. */
const ALL_PLACES = 19;
const PARKSTAY_PLACES = 11;
/** ParkStay's 3 campgrounds with a site free, and RAC's 7 parks other than Busselton. */
const AVAILABLE = 10;

const BUSSELTON = 'RAC Busselton Holiday Park';
const BUSSELTON_ANSWER = 'rac/availability-busselton-2026-11-06-2n.json';
const CONTACT_PAGE = 'https://parksandresorts.rac.com.au/busselton/contact-us/';
const BUNGARRA_VIEW = 'parkstay/campsite_availablity_view_20.json';

/** A card when something is free for the whole stay: "2 of 3 sites available", "51 spots free". */
const SOMETHING_FREE = /\b\d+ of \d+ \w+ available\b|\b\d+ \w+ free\b/;
/** A card's text when nothing is free for the whole stay. */
const NONE_FREE = /\bNo \w+ free every night\b/;

/** What WA Stay reads of one RAC category. */
interface RacCategory {
  category_name: string;
  sites_available: Record<string, number>;
  sites_code: Record<string, number>;
  stay_through_sites_available: number;
  stay_through_sites_code: number;
  stay_through_sites_message: string;
}

/** A ParkStay night: `[bookable, label, price, _, _, date]`. */
type ParkStayNight = [boolean, string, string, null, null, string];

interface ParkStayView {
  sites: { name: string; price: string | false; availability: ParkStayNight[] }[];
}

test('RAC: a park free only if you move reads so on Explore, its page and a watch, booked by contacting the park', async ({
  launchWaStay,
  tempDir,
}) => {
  test.setTimeout(120_000);
  const fixtures = writeDatedFixtures(tempDir('split-rac'));
  const { arrival } = fixtures;
  const departure = addDays(arrival, 2);
  // Every category free every night has no site for the whole stay: RAC's split answer
  const edited: string[] = [];
  editDatedFixture<{ data: Record<string, RacCategory> }>(fixtures, BUSSELTON_ANSWER, (answer) => {
    for (const category of Object.values(answer.data)) {
      const nights = Object.keys(category.sites_code);
      const freeEveryNight = nights.every(
        (night) => category.sites_code[night] === 0 && category.sites_available[night] > 0
      );
      if (!freeEveryNight) continue;
      category.stay_through_sites_available = 0;
      category.stay_through_sites_code = 3;
      category.stay_through_sites_message = 'There is no longer availability for the dates given';
      edited.push(category.category_name);
    }
  });
  expect(edited).toEqual(['Powered Site']);

  const wa = await launchWaStay({
    providers: ['parkstay', 'rac'],
    env: { WA_STAY_E2E_FIXTURES_DIR: fixtures.dir },
  });
  const { window } = wa;
  const results = window.getByRole('region', { name: 'Results' });
  await expect(
    results.getByRole('heading', { level: 2, name: `${ALL_PLACES} places` })
  ).toBeVisible({ timeout: CATALOGUE_TIMEOUT_MS });

  // 1. Explore with the dates (a link to them): Busselton is free only if you move, and never
  // counted as available
  await window.evaluate((hash) => {
    location.hash = hash;
  }, `#/?arrival=${arrival}&departure=${departure}`);
  await expectRoute(window, `/?arrival=${arrival}&departure=${departure}`);
  const range = stayRangeLabel(arrival, departure);
  await expect(
    results.getByRole('heading', {
      level: 2,
      name: `${ALL_PLACES} places · ${AVAILABLE} available for ${range}`,
    })
  ).toBeVisible({ timeout: 20_000 });
  const busselton = results.getByRole('link', { name: BUSSELTON, exact: true });
  await expect(busselton).toHaveAccessibleDescription(/Free if you move sites/);
  await expect(busselton.getByText('Free if you move sites', { exact: true })).toBeVisible();
  await expect(busselton).not.toHaveAccessibleDescription(SOMETHING_FREE);

  // After every place with something free, and right before the first that has none
  const cards = () =>
    results.getByRole('link').evaluateAll((links) =>
      // innerText keeps the card's lines apart ("Gascoyne", then "75 spots free")
      links.map((link) => ({
        name: document.getElementById(link.getAttribute('aria-labelledby') ?? '')?.innerText,
        details:
          document.getElementById(link.getAttribute('aria-describedby') ?? '')?.innerText ?? '',
      }))
    );
  await expect
    .poll(async () => {
      const list = await cards();
      const at = list.findIndex((card) => card.name === BUSSELTON);
      return {
        at,
        notFreeBefore: list
          .slice(0, at)
          .filter((card) => !SOMETHING_FREE.test(card.details))
          .map((card) => card.name),
        nextIsNoneFree: NONE_FREE.test(list[at + 1]?.details ?? ''),
      };
    })
    .toEqual({ at: AVAILABLE, notFreeBefore: [], nextIsNoneFree: true });

  // "Available only" hides it: it is never available
  const availableOnly = window
    .getByRole('group', { name: 'Filters' })
    .getByRole('button', { name: 'Available only' });
  await availableOnly.click();
  await expect(availableOnly).toHaveAttribute('aria-pressed', 'true');
  await expect(results.getByRole('link')).toHaveCount(AVAILABLE);
  await expect(busselton).toHaveCount(0);
  await availableOnly.click();
  await expect(availableOnly).toHaveAttribute('aria-pressed', 'false');

  // 2. Busselton's page, for the same stay: the block under the night grid
  await busselton.click();
  await expect.poll(() => currentRoute(window)).toMatch(/^\/places\/rac\/busselton\?/);
  await window
    .getByRole('region', { name: 'Check your dates' })
    .getByRole('button', { name: 'Check availability' })
    .click();
  const placeAvailability = window.getByRole('region', { name: 'Availability', exact: true });
  const placeSplit = placeAvailability.getByRole('region', { name: 'Free if you move sites' });
  await expect(placeSplit).toBeVisible({ timeout: 20_000 });
  await expectContactBlock(placeSplit);
  // Never "available"
  await expect(placeSplit).not.toContainText(/available/i);

  // 3. A prefilled watch for camping, alerting on split stays too
  await window.evaluate((hash) => {
    location.hash = hash;
  }, `#/watches/new?provider=rac&location=busselton&arrival=${arrival}&departure=${departure}&adults=2`);
  await expectHeadingFocused(window, 'New watch');
  const steps = window.getByRole('navigation', { name: 'New watch steps' });
  await expectCurrentStep(steps, 'Your stay');
  const camping = window.getByRole('group', { name: 'Stay type' }).getByRole('button', {
    name: 'Camping',
  });
  await camping.click();
  await expect(camping).toHaveAttribute('aria-pressed', 'true');
  await window.getByRole('button', { name: 'Continue' }).click();

  await expect(window.getByRole('heading', { level: 2, name: /Alerts$/ })).toBeFocused();
  const splitOption = window.getByRole('checkbox', {
    name: 'Alert on stays that move between sites',
  });
  await expect(splitOption).not.toBeChecked();
  await splitOption.check();
  await window.getByRole('button', { name: 'Continue' }).click();

  await expect(window.getByRole('heading', { level: 2, name: /Review$/ })).toBeFocused();
  await expect(
    window.getByText(/When the whole stay is free; also when it's free only if you move sites/)
  ).toBeVisible();
  const name = await window.getByRole('textbox', { name: 'Name' }).inputValue();
  await window.getByRole('button', { name: 'Create watch' }).click();
  await expect
    .poll(() => window.evaluate(() => document.location.hash))
    .toMatch(/^#\/watches\/\d+$/);
  const watchRoute = await currentRoute(window);
  await expect(window.getByRole('heading', { level: 1, name })).toBeVisible();

  // 4. Check now: the result line, the block and its link, and no "Book on RAC"
  await window.getByRole('button', { name: 'Check now' }).click();
  const watchAvailability = window.getByRole('region', { name: 'Availability', exact: true });
  await expect(
    watchAvailability.getByText(/^From the check .+: Free if you move sites$/)
  ).toBeVisible({ timeout: 20_000 });
  const watchSplit = watchAvailability.getByRole('region', { name: 'Free if you move sites' });
  await expectContactBlock(watchSplit);
  await expect(window.getByRole('link', { name: /^Book on RAC/ })).toHaveCount(0);
  // The grid shows every row, and says why the Powered Site's free nights make no stay
  await expect(
    watchAvailability.getByRole('table', { name: /^Availability by night, / })
  ).toBeVisible();
  await expect(
    watchAvailability.getByText('Free every night, but not on one site for the whole stay.', {
      exact: true,
    })
  ).toBeVisible();

  // 5. The bell: the split alert (the scheduler's first check may have sent one too), which
  // opens the watch
  const bell = window.getByRole('button', { name: /^Notifications, \d+ unread$/ });
  await expect(bell).toBeVisible({ timeout: 20_000 });
  await bell.click();
  const notices = window.getByRole('dialog', { name: 'Notifications' });
  const alert = notices
    .getByRole('link', { name: `Free if you move sites at ${BUSSELTON}` })
    .first();
  await expect(alert).toBeVisible();
  await alert.click();
  await expectRoute(window, watchRoute);
  await expect(window.getByRole('heading', { level: 1, name })).toBeVisible();

  // Nothing left the fixtures, and the window logged no errors
  const requests = wa.unexpectedRequests();
  expect(withoutRemoteImages(requests)).toEqual([]);
  expect(withoutGuardedRequests(await wa.consoleErrors(), requests)).toEqual([]);
});

/**
 * RAC's split-stay block, on the place page or a watch: the Powered Site at about its public
 * nightly rates ($75 a night), booked through the park: "Contact RAC Busselton Holiday Park",
 * its contact page, which opens in the browser and is never followed here.
 */
async function expectContactBlock(block: Locator): Promise<void> {
  await expect(
    block.getByRole('heading', { level: 3, name: 'Free if you move sites' })
  ).toBeVisible();
  await expect(block.getByRole('heading', { level: 4, name: 'Powered Site' })).toBeVisible();
  await expect(block.getByText('About $150 for the 2 nights', { exact: true })).toBeVisible();
  await expect(
    block.getByText(`${BUSSELTON} can book this for you as separate stays.`, { exact: true })
  ).toBeVisible();
  const contact = block.getByRole('link', { name: `Contact ${BUSSELTON} (opens in your browser)` });
  await expect(contact).toBeVisible();
  await expect(contact).toHaveAttribute('href', CONTACT_PAGE);
  await expect(contact).toHaveAttribute('target', '_blank');
}

test('ParkStay: a stay free only by moving between sites lists its parts, each booked on ParkStay for its own dates', async ({
  launchWaStay,
  tempDir,
}) => {
  test.setTimeout(90_000);
  const fixtures = writeDatedFixtures(tempDir('split-parkstay'));
  const { arrival } = fixtures;
  const middle = addDays(arrival, 1);
  const departure = addDays(arrival, 2);
  // CAMPSITE 03 free on the first night only, CAMPSITE 04 on the second only, 05 on neither
  const taken = (night: ParkStayNight): ParkStayNight => [
    false,
    'Unavailable',
    night[2],
    null,
    null,
    night[5],
  ];
  editDatedFixture<ParkStayView>(fixtures, BUNGARRA_VIEW, (view) => {
    const freeOn: Record<string, number[]> = {
      'CAMPSITE 03': [0],
      'CAMPSITE 04': [1],
      'CAMPSITE 05': [],
    };
    for (const site of view.sites) {
      const free = freeOn[site.name];
      if (!free) continue;
      site.availability = site.availability.map((night, i) =>
        free.includes(i) ? night : taken(night)
      );
      site.price = false;
    }
  });

  const wa = await launchWaStay({ env: { WA_STAY_E2E_FIXTURES_DIR: fixtures.dir } });
  const { window } = wa;
  await expect(
    window
      .getByRole('region', { name: 'Results' })
      .getByRole('heading', { level: 2, name: `${PARKSTAY_PLACES} places` })
  ).toBeVisible({ timeout: CATALOGUE_TIMEOUT_MS });

  // Bungarra's page with the dates, and its check
  await window.evaluate((hash) => {
    location.hash = hash;
  }, `#/places/parkstay/20?arrival=${arrival}&departure=${departure}`);
  await expect(window.getByRole('heading', { level: 1, name: 'Bungarra' })).toBeVisible();
  await window
    .getByRole('region', { name: 'Check your dates' })
    .getByRole('button', { name: 'Check availability' })
    .click();
  const availability = window.getByRole('region', { name: 'Availability', exact: true });
  // No site is free for both nights, so "Fully available only" lists none
  await expect(
    availability.getByText('0 of 5 sites free for all 2 nights', { exact: true })
  ).toBeVisible({ timeout: 20_000 });

  // The block: across two sites, in two parts, each booked on ParkStay for its own dates
  const split = availability.getByRole('region', { name: 'Free if you move sites' });
  await expect(
    split.getByRole('heading', { level: 3, name: 'Free if you move sites' })
  ).toBeVisible();
  await expect(split.getByRole('heading', { level: 4, name: 'Across 2 sites' })).toBeVisible();
  await expect(split.getByText('About $60 for the 2 nights', { exact: true })).toBeVisible();
  const parts = split.getByRole('list').getByRole('listitem');
  await expect(parts).toHaveCount(2);
  const firstRange = stayRangeLabel(arrival, middle);
  const secondRange = stayRangeLabel(middle, departure);
  await expect(parts.nth(0)).toContainText(`CAMPSITE 03 · ${firstRange} · 1 night`);
  await expect(parts.nth(1)).toContainText(`CAMPSITE 04 · ${secondRange} · 1 night`);
  await expect(
    split.getByText('Book each part on ParkStay: 2 bookings in all.', { exact: true })
  ).toBeVisible();

  const partLinks = [
    { range: firstRange, from: arrival, to: middle, item: parts.nth(0) },
    { range: secondRange, from: middle, to: departure, item: parts.nth(1) },
  ];
  for (const { range, from, to, item } of partLinks) {
    const book = item.getByRole('link', {
      name: `Book ${range} on ParkStay (opens in your browser)`,
    });
    await expect(book).toBeVisible();
    await expect(book).toHaveAttribute('target', '_blank');
    const href = new URL((await book.getAttribute('href')) ?? '');
    expect(href.origin).toBe('https://parkstay.dbca.wa.gov.au');
    expect(href.searchParams.get('campground_id')).toBe('20');
    expect([href.searchParams.get('arrival'), href.searchParams.get('departure')]).toEqual([
      from.replaceAll('-', '/'),
      to.replaceAll('-', '/'),
    ]);
  }
  await expect(split).not.toContainText(/available/i);

  // Nothing left the fixtures, and the window logged no errors
  const requests = wa.unexpectedRequests();
  expect(withoutRemoteImages(requests)).toEqual([]);
  expect(withoutGuardedRequests(await wa.consoleErrors(), requests)).toEqual([]);
});
