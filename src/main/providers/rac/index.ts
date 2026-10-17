/**
 * RAC Parks & Resorts: RAC's holiday parks and resorts across Western Australia, WA Stay's
 * second provider. For now its eight open parks are on Explore, each with its categories
 * (powered site, two-bedroom cabin, dorm…) on its page.
 *
 * - `manifest.ts`: who RAC is, what the module does, and its limits;
 * - `parks.ts`: the parks, as a seed of facts (no request per sync);
 * - `catalog.ts` and `book-now.ts`: the catalogue, and a park's categories from its book-now
 *   page; `unit-kinds.ts`: what each category is;
 * - `links.ts`: RAC's own pages, never its cart;
 * - `client.ts`: every request, on RAC's host only, with the block cool-down.
 *
 * **Terms** (`ai-state/research/rac-terms.md`, read 16 Oct 2026). Nothing in RAC's terms
 * addresses automated access, and robots.txt allows every path with a 10 s crawl delay; the
 * site's terms limit its use to "personal non-commercial home use". So the module:
 * 1. talks only to RAC's own host, for the person's own trip, from their own computer;
 * 2. sends at most one background request every 10 s, and none when the catalogue syncs;
 * 3. lets watches run every 15 minutes at most (when they come);
 * 4. sends one request at a time, on one session;
 * 5. never answers or works around a bot check: a block stops every request for 30 minutes;
 * 6. shows facts (names, categories) and links to RAC's pages; RAC's photos and descriptions
 *    are fetched live and shown only in the app;
 * 7. keeps nothing of RAC's in the repository's fixtures but trimmed facts (a test checks it);
 * 10. never cancels or changes a booking: there is no bookings module.
 */

import { defineProvider, type ProviderModules } from '../sdk/provider';
import type { ProviderContext } from '../sdk/context';
import { createRacCatalog } from './catalog';
import { RacClient } from './client';
import { racLinks } from './links';
import { racManifest } from './manifest';

export { RAC_SITE_URL } from './client';
export { racLinks } from './links';
export { RAC_PARKS } from './parks';
export { RAC_PROVIDER_ID, racManifest } from './manifest';

/** The RAC modules for `ctx`. */
export function createRacModules(ctx: ProviderContext): ProviderModules {
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
  return {
    links: racLinks,
    catalog: createRacCatalog({ ctx, client, links: racLinks }),
  };
}

/** What `BUILT_IN_PROVIDERS` in `src/main/providers/index.ts` registers. */
export const racFactory = defineProvider(racManifest, (ctx) => createRacModules(ctx));
