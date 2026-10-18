/**
 * Stay Rottnest: Rottnest Island's accommodation, booked through the Rottnest Island
 * Authority's Stay Rottnest, WA Stay's third provider. Its nine precincts are on Explore with
 * their room types; one search of Stay Rottnest's results page answers a stay for the whole
 * island, which the place page's check, Explore's free counts and every watch share. Nothing
 * holds, carts or books: alerts link to Stay Rottnest's own search, and the person books there.
 *
 * - `manifest.ts`: who Stay Rottnest is, what the module does, and its limits;
 * - `precincts.ts`: the precincts and their room types, a seed of facts (no request per sync);
 * - `catalog.ts`: the catalogue, from the seed;
 * - `availability.ts` and `results-page.ts`: the shared search and its reading;
 * - `open-days.ts`: Stay Rottnest's Open Days, for the client's Open Day pause;
 * - `links.ts`: Stay Rottnest's own pages, never its booking step;
 * - `client.ts`: every request, `GET /rates-room1` only, with the block cool-down.
 *
 * **Terms** (`ai-state/research/rottnest-terms.md`). Clause 4 of Stay Rottnest's booking terms
 * says bookings may not be "made or assisted by the use of automated software", naming "web
 * scraping, data mining, rate shopping, booking"; RIA may cancel a suspect booking without
 * refund and block IP addresses. The stakeholder decided to offer an automatic watch knowing
 * that (brief Project 3, T1), and the review's §9 sets its conditions, which this module keeps:
 * 2. notify only: nothing but `GET /rates-room1`, never a hold, cart, form or the booking step;
 * 3. slow: one request at a time, 60 s apart in the background, one shared search per stay and
 *    party, watches every 30 minutes at most;
 * 4. quiet on Open Day mornings (5:30 am to noon Perth);
 * 5. no evasion: the app's one browser identity, no redirect followed, and a block, challenge
 *    or waiting room stops every request for 12 hours, doubling to 7 days;
 * 6. anonymous: no account, no cookie of the person's;
 * 7. facts only: no RIA photos, descriptions, maps or logos, in the seed or the fixtures.
 * Condition 1, the person's own acceptance of a notice before anything is sent, is the core's.
 */

import { defineProvider, type ProviderModules } from '../sdk/provider';
import type { ProviderContext } from '../sdk/context';
import { createRottnestAvailability } from './availability';
import { createRottnestCatalog } from './catalog';
import { RottnestClient } from './client';
import { rottnestLinks } from './links';
import { rottnestManifest } from './manifest';

export { ROTTNEST_BOOKINGS_URL, ROTTNEST_SITE_URL, rottnestLinks, searchUrl } from './links';
export { ROTTNEST_PRECINCTS } from './precincts';
export { ROTTNEST_PROVIDER_ID, rottnestManifest } from './manifest';

/** The Stay Rottnest modules for `ctx`. */
export function createRottnestModules(ctx: ProviderContext): ProviderModules {
  const client = new RottnestClient({
    providerId: ctx.id,
    providerName: ctx.manifest.name,
    http: ctx.http,
    state: ctx.state,
    logger: ctx.logger,
    clock: ctx.clock,
    maxConcurrent: ctx.limits.maxConcurrentRequests,
  });
  const availability = createRottnestAvailability({ ctx, client });
  return {
    links: rottnestLinks,
    catalog: createRottnestCatalog({ ctx, links: rottnestLinks }),
    availability: { check: availability.check, search: availability.search },
    async dispose() {
      availability.dispose();
    },
  };
}

/** What `BUILT_IN_PROVIDERS` in `src/main/providers/index.ts` registers. */
export const rottnestFactory = defineProvider(rottnestManifest, createRottnestModules);
