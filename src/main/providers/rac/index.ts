/**
 * RAC Parks & Resorts: RAC's holiday parks and resorts across Western Australia, WA Stay's
 * second provider. Its eight open parks are on Explore, each with its categories (powered site,
 * two-bedroom cabin, dorm…) on its page and its free units for the dates Explore is given; a
 * stay's availability is checked per category, with prices and RAC's stay rules, and watches
 * run on it. Site Sniper alerts when a stay's dates open (RAC's holds are off, so a snipe never
 * holds).
 *
 * - `manifest.ts`: who RAC is, what the module does, and its limits;
 * - `parks.ts`: the parks, as a seed of facts (no request per sync);
 * - `catalog.ts` and `book-now.ts`: the catalogue, and a park's categories from its book-now
 *   page (a native park's from one availability POST); `unit-kinds.ts`: what each category is;
 * - `availability.ts` and `mapping.ts`: a stay's availability, from RAC's availability answer;
 * - `bulk.ts`: Explore's free counts, one POST per park;
 * - `release-policy.ts` and `release-calendar.ts`: when a stay opens (the rolling 364-day
 *   window, or a school-holiday release, 48 hours earlier for members), for snipes and for
 *   availability's `release.opensAt`;
 * - `links.ts`: RAC's own pages, never its cart;
 * - `client.ts`: every request, on RAC's host only, with the block cool-down.
 *
 * **Terms** (`ai-state/research/rac-terms.md`, read 16 Oct 2026). Nothing in RAC's terms
 * addresses automated access, and robots.txt allows every path with a 10 s crawl delay; the
 * site's terms limit its use to "personal non-commercial home use". So the module:
 * 1. talks only to RAC's own host, for the person's own trip, from their own computer;
 * 2. sends at most one background request every 10 s, and none when the catalogue syncs (what
 *    the person asks for, such as Explore's dates, goes 1 s after the request before it);
 * 3. lets watches run every 15 minutes at most, and a snipe check every 10 s for at most 30
 *    minutes after its release (no faster near a release);
 * 4. sends one request at a time, on one session;
 * 5. never answers or works around a bot check: a block stops every request for 30 minutes,
 *    longer for blocks in a row or when RAC asks (up to a day);
 * 6. shows facts (names, categories) and links to RAC's pages; RAC's photos and descriptions
 *    are fetched live and shown only in the app;
 * 7. keeps nothing of RAC's in the repository's fixtures but trimmed facts (a test checks it);
 * 10. never cancels or changes a booking: there is no bookings module;
 * 14. times the member pre-sale only for a person with a member number (`isMember`);
 * 16. respects RAC's stay rules: a stay RAC refuses (a minimum, an arrival day, a closed or
 *     unreleased date, too many pets) is never free, and a booking takes at most two pets.
 */

import { defineProvider, type ProviderModules } from '../sdk/provider';
import type { ProviderContext } from '../sdk/context';
import { createRacAvailability } from './availability';
import { createRacBulkSearch } from './bulk';
import { createRacCatalog } from './catalog';
import { RacClient } from './client';
import { racLinks } from './links';
import { racManifest } from './manifest';
import { RacReleasePolicy } from './release-policy';
import { createKindResolver } from './unit-kinds';

export { RAC_SITE_URL } from './client';
export { racLinks } from './links';
export { RAC_PARKS } from './parks';
export { RAC_PROVIDER_ID, racManifest } from './manifest';

export interface RacModuleOptions {
  /**
   * Whether the person has saved an RAC member number, asked at every release compute. Until
   * the member number can be saved, no one is a member.
   */
  isMember?: () => Promise<boolean>;
}

/** The RAC modules for `ctx`. */
export function createRacModules(
  ctx: ProviderContext,
  options: RacModuleOptions = {}
): ProviderModules {
  const client = new RacClient({
    providerId: ctx.id,
    providerName: ctx.manifest.name,
    http: ctx.http,
    state: ctx.state,
    logger: ctx.logger,
    clock: ctx.clock,
    timezone: ctx.timezone,
    maxConcurrent: ctx.limits.maxConcurrentRequests,
  });
  const kindOf = createKindResolver((message) => ctx.logger.warn(message));
  const release = new RacReleasePolicy({
    providerId: ctx.id,
    isMember: options.isMember ?? (async () => false),
  });
  const availability = createRacAvailability({ ctx, client, links: racLinks, kindOf, release });
  return {
    links: racLinks,
    catalog: createRacCatalog({ ctx, client, links: racLinks, availability, kindOf }),
    availability: { ...availability, search: createRacBulkSearch({ ctx, availability }) },
    release,
  };
}

/** What `BUILT_IN_PROVIDERS` in `src/main/providers/index.ts` registers. */
export const racFactory = defineProvider(racManifest, (ctx) => createRacModules(ctx));
