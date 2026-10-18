/**
 * RAC Parks & Resorts: RAC's holiday parks and resorts across Western Australia, WA Stay's
 * second provider. Its eight open parks are on Explore, each with its categories (powered site,
 * two-bedroom cabin, dorm…) on its page and its free units for the dates Explore is given; a
 * stay's availability is checked per category, with prices and RAC's stay rules, and watches
 * run on it. Site Sniper alerts when a stay's dates open (RAC's holds are off, so a snipe never
 * holds). A person who saves their RAC member number in Settings → Accounts gets members' rates
 * and the member pre-sale's release times. Auto-cart (R19) is built but off: only with the
 * `autoCart` experiment on (`ctx.manifest.capabilities.holds`) does the factory build `holds`
 * and give the client cart access.
 *
 * - `manifest.ts`: who RAC is, what the module does, and its limits;
 * - `parks.ts`: the parks, as a seed of facts;
 * - `catalog.ts` and `book-now.ts`: the catalogue, and a park's categories from its book-now
 *   page (a native park's from one availability POST); `unit-kinds.ts`: what each category is;
 *   `park-pages.ts`: the parks' card photos (RAC's parks page, once per sync) and a park's own
 *   photos and intro (its home page, with its detail);
 * - `availability.ts` and `mapping.ts`: a stay's availability, from RAC's availability answer;
 * - `bulk.ts`: Explore's free counts, one POST per park;
 * - `release-policy.ts` and `release-calendar.ts`: when a stay opens (the rolling 364-day
 *   window, or a school-holiday release, 48 hours earlier for members), for snipes and for
 *   availability's `release.opensAt`;
 * - `links.ts`: RAC's own pages, never its cart;
 * - `auth.ts` and `membership.ts`: the person's own member number (a `credentials` sign-in that
 *   checks its format and sends nothing), and whether one is saved, which every module asks;
 * - `holds.ts` and `cart-page.ts`: the auto-cart (the experiment's), its cart page and release;
 * - `client.ts` and `cart-guard.ts`: every request, on RAC's host only, with the block
 *   cool-down, and never to checkout, payment or NewBook (the cart only while it is on).
 *
 * **Terms** (`ai-state/research/rac-terms.md`, read 16 Oct 2026). Nothing in RAC's terms
 * addresses automated access, and robots.txt allows every path with a 10 s crawl delay; the
 * site's terms limit its use to "personal non-commercial home use". So the module:
 * 1. talks only to RAC's own host, for the person's own trip, from their own computer;
 * 2. sends at most one background request every 10 s, and one when the catalogue syncs (RAC's
 *    parks page, for the cards' photos); what the person asks for, such as Explore's dates or a
 *    park's page, goes 1 s after the request before it;
 * 3. lets watches run every 15 minutes at most, and a snipe check every 10 s for at most 30
 *    minutes after its release (no faster near a release);
 * 4. sends one request at a time, on one session;
 * 5. never answers or works around a bot check: a block stops every request for 30 minutes,
 *    longer for blocks in a row or when RAC asks (up to a day);
 * 6. shows facts (names, categories) and links to RAC's pages; RAC's photos and its words about
 *    a park are fetched live, shown as RAC publishes them and only in the app;
 * 7. keeps nothing of RAC's in the repository's fixtures but trimmed facts (a test checks it);
 *    the cart's fixtures are synthetic, written from RAC's scripts (no cart was ever opened),
 *    and so are the parks page and home pages, with made-up words and photo addresses;
 * 8. leaves payment and acceptance to the person: the cart guard refuses checkout, card and
 *    NewBook calls, and the auto-cart sends one GET of the cart address and nothing more;
 * 10. never cancels or changes a booking: there is no bookings module, and a release takes out
 *     only a stay the cart still holds (a paid one has left it);
 * 11. keeps only the person's own member number, one, saved with their three confirmations;
 * 12. keeps it secret: encrypted by the core, never logged, returned or sent (RAC's checkout
 *     gets it from the person); no module reads it, only whether it is saved (`membership.ts`);
 * 13. holds at most one stay at a time (one cart, `holds.ts`), and never two for the same nights
 *     (the core's night guard), well inside the member's two bookings per period;
 * 14. counts members' tariffs and times the member pre-sale only for a person with a member
 *     number (`isMember`);
 * 15. holds only with the experiment on: one cart, let go when the person declines or the
 *     payment window closes, never "secured" (no `bookedReference`), never live in a test;
 * 16. respects RAC's stay rules: a stay RAC refuses (a minimum, an arrival day, a closed or
 *     unreleased date, too many pets) is never free, and a booking takes at most two pets.
 */

import { defineProvider, type ProviderModules } from '../sdk/provider';
import type { ProviderContext } from '../sdk/context';
import { createRacAuth } from './auth';
import { createRacAvailability } from './availability';
import { createRacBulkSearch } from './bulk';
import { createRacCatalog } from './catalog';
import { RacClient } from './client';
import { createRacHolds } from './holds';
import { createRacLinks } from './links';
import { racManifest } from './manifest';
import { createMembership, hasMemberNumber } from './membership';
import { RacReleasePolicy } from './release-policy';
import { createCategoryMemo, createKindResolver } from './unit-kinds';

export { RAC_SITE_URL } from './client';
export { racLinks } from './links';
export { RAC_PARKS } from './parks';
export { RAC_AUTO_CART_EXPERIMENT, RAC_PROVIDER_ID, racManifest } from './manifest';

export interface RacModuleOptions {
  /**
   * Whether the person has saved an RAC member number, asked at every check, bulk search and
   * release compute. Default: `hasMemberNumber(ctx)` (`membership.ts`); a failure counts as no
   * member.
   */
  isMember?: () => Promise<boolean>;
}

/** The RAC modules for `ctx`. */
export function createRacModules(
  ctx: ProviderContext,
  options: RacModuleOptions = {}
): ProviderModules {
  // The cart is the `autoCart` experiment's: off, there is no holds module and no cart access
  const cartEnabled = ctx.manifest.capabilities.holds === true;
  const client = new RacClient({
    providerId: ctx.id,
    providerName: ctx.manifest.name,
    http: ctx.http,
    state: ctx.state,
    logger: ctx.logger,
    clock: ctx.clock,
    timezone: ctx.timezone,
    maxConcurrent: ctx.limits.maxConcurrentRequests,
    cartEnabled,
  });
  const kindOf = createKindResolver((message) => ctx.logger.warn(message));
  // One place every module learns membership from: a boolean, never the number
  const membership = createMembership(options.isMember ?? (() => hasMemberNumber(ctx)), ctx.logger);
  // `links.booking` is synchronous, so it reads the last answer: read once now (a local vault
  // read, no request), then at every check, bulk search and release compute. After a save or
  // removal it is current from the next of those (the core asks a release again at once for
  // an armed snipe). Only a book-now link with a stay and no category carries it, which the core
  // never asks for (its links name a category); a check's own link uses its own answer.
  void membership.read();
  const links = createRacLinks(membership.last);
  const release = new RacReleasePolicy({
    providerId: ctx.id,
    isMember: membership.read,
    logger: ctx.logger,
  });
  // What each category is, from this run's checks: a hold must know a site before it asks
  const categories = createCategoryMemo();
  const availability = createRacAvailability({ ctx, client, links, kindOf, release, categories });
  return {
    links,
    catalog: createRacCatalog({ ctx, client, links, availability, kindOf, release }),
    availability: { ...availability, search: createRacBulkSearch({ ctx, availability }) },
    release,
    auth: createRacAuth(ctx),
    ...(cartEnabled
      ? { holds: createRacHolds({ ctx, client, membership, categories, kindOf }) }
      : {}),
  };
}

/** What `BUILT_IN_PROVIDERS` in `src/main/providers/index.ts` registers. */
export const racFactory = defineProvider(racManifest, (ctx) =>
  createRacModules(ctx, { isMember: () => hasMemberNumber(ctx) })
);
