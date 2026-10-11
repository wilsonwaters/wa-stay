/**
 * ParkStay WA (DBCA): the first provider module (architecture-notes §1, §3).
 *
 * Everything DBCA-specific lives in this folder, built only on endpoints checked live
 * (2 Oct 2026) and in the DBCA backend source (`dbca-wa/parkstay_bs_v2`):
 *
 * - `catalog.ts`: every campground (`/api/campground_map/`) and a campground's detail;
 * - `availability.ts`: per-campground nights with prices, and bulk free-site counts;
 * - `site-classes.ts`: campgrounds listed by site class (Lucky Bay), one unit per class;
 * - `queue/`: the DBCA virtual queue as the access gate;
 * - `release-policy.ts`: daily rollover, scheduled and cancellation releases;
 * - `holds.ts`: 30-minute `create_booking` holds and the payment page;
 * - `auth.ts`: sign-in on ParkStay's own pages, checked with `/api/profile`;
 * - `links.ts`, `client.ts`, `headers.ts`, `constants.ts`, `types.ts`.
 */

import type { ProviderManifest } from '@shared/types/provider.types';
import { SnipeReleaseMode } from '@shared/types/common.types';
import { addDays } from '@shared/utils/calendar-date';
import type { ProviderContext } from '../sdk/context';
import { defineProvider, type ProviderModules } from '../sdk/provider';
import { createParkStayAuth } from './auth';
import { CampsiteViews, createAvailability } from './availability';
import { CampgroundFacts, createCatalog } from './catalog';
import { ParkStayClient, PARKSTAY_ENDPOINTS, type ParkStayEndpoints } from './client';
import { PARKSTAY_BASE_URL, PARKSTAY_PROVIDER_ID } from './constants';
import { createHolds } from './holds';
import { parkstayLinks } from './links';
import { ParkStayAccessGate, type AccessGateTimings } from './queue/access-gate';
import { QueueApi } from './queue/queue-api';
import { ParkStayReleasePolicy } from './release-policy';

export { PARKSTAY_PROVIDER_ID } from './constants';
export { parkstayLinks } from './links';

export const parkstayManifest: ProviderManifest = {
  id: PARKSTAY_PROVIDER_ID,
  name: 'ParkStay WA',
  shortName: 'ParkStay',
  description: "Campgrounds in Western Australia's national parks, booked through DBCA ParkStay.",
  website: PARKSTAY_BASE_URL,
  integration: 'api',
  // Dark eucalypt green; a white monogram on it passes WCAG AA.
  brand: { color: '#2F5D50', monogram: 'PS' },
  locationKinds: [
    'campground',
    'holiday-park',
    'caravan-park',
    'cabin',
    'hut',
    'glamping',
    'farm-stay',
    'other',
  ],
  timezone: 'Australia/Perth',
  currency: 'AUD',
  capabilities: {
    catalog: true,
    // ParkStay lists every campground in one call (`/api/campground_map/`).
    catalogMode: 'full',
    availability: true,
    bulkAvailability: true,
    watches: true,
    snipes: true,
    holds: true,
    bookingImport: false,
    accessGate: true,
    // Holds need no sign-in and a ParkStay session lasts an hour, so signing in is a
    // convenience (checkout is quicker), never a precondition (architecture-notes §12.32).
    account: 'optional',
  },
  limits: {
    // Polite polling: availability changes rarely between quarter hours outside a release.
    minWatchIntervalMinutes: 15,
    maxConcurrentRequests: 4,
    // The campground list changes a few times a year.
    catalogTtlHours: 24,
  },
  stayFields: [
    {
      key: 'gearType',
      label: 'Camping with',
      type: 'select',
      options: [
        { value: 'all', label: 'Any' },
        { value: 'tent', label: 'Tent' },
        { value: 'campervan', label: 'Campervan' },
        { value: 'caravan', label: 'Caravan' },
      ],
      default: 'all',
      appliesTo: ['watch', 'snipe'],
    },
    {
      key: 'numVehicles',
      label: 'Vehicles',
      type: 'number',
      min: 0,
      max: 5,
      default: 1,
      appliesTo: ['snipe', 'hold'],
    },
    {
      key: 'postcode',
      label: 'Postcode',
      help: 'Your four-digit Australian postcode, which ParkStay asks for with a booking.',
      type: 'text',
      pattern: '^\\d{4}$',
      appliesTo: ['snipe', 'hold'],
    },
  ],
  // The bulk view reads only the dates and the gear type (`campground_availabilty_view`); the
  // party is ignored, so changing guests reuses the answer.
  bulkAvailabilityStayFields: ['arrival', 'departure', 'equipment', 'params.gearType'],
  releaseModes: [
    {
      id: SnipeReleaseMode.DAILY_ROLLOVER,
      label: 'When new dates open',
      description:
        "Each day ParkStay opens one more date, 180 days ahead, at the campground's release time.",
      usesAccessGate: true,
    },
    {
      id: SnipeReleaseMode.SCHEDULED,
      label: 'At a scheduled time',
      description:
        'For campgrounds whose dates are released in blocks (such as Ningaloo), at a time you set.',
      usesAccessGate: true,
    },
    {
      id: SnipeReleaseMode.CANCELLATION,
      label: 'When someone cancels',
      description: 'Keeps checking for a site that comes free.',
      usesAccessGate: false,
    },
  ],
};

export interface ParkStayModuleOptions {
  /** Where requests go; tests use a local fixture server. */
  endpoints?: ParkStayEndpoints;
  /** Queue timings; tests shorten them. */
  accessTimings?: Partial<AccessGateTimings>;
}

/** The ParkStay modules for `ctx`. */
export function createParkStayModules(
  ctx: ProviderContext,
  options: ParkStayModuleOptions = {}
): ProviderModules {
  const client = new ParkStayClient(
    ctx.http,
    ctx.id,
    options.endpoints ?? PARKSTAY_ENDPOINTS,
    ctx.limits.maxConcurrentRequests
  );
  const facts = new CampgroundFacts();
  const release: ParkStayReleasePolicy = new ParkStayReleasePolicy({
    providerId: ctx.id,
    state: ctx.state,
    facts,
    timeZone: ctx.timezone,
    logger: ctx.logger,
    clock: ctx.clock,
    // A one-night probe from tomorrow tells the policy the campground's release facts.
    loadView: async (externalId, signal) => {
      const today = release.today();
      const probe = { arrival: addDays(today, 1), departure: addDays(today, 2), adults: 1 };
      await views.fetch(externalId, probe, signal);
    },
  });
  const views = new CampsiteViews({ ctx, client, facts, release });
  const access = new ParkStayAccessGate({
    providerId: ctx.id,
    api: new QueueApi(client, ctx.id),
    cookies: ctx.http.cookies,
    state: ctx.state,
    logger: ctx.logger,
    clock: ctx.clock,
    timings: options.accessTimings,
  });

  const availability = createAvailability({ ctx, client, facts, views, release });

  return {
    links: parkstayLinks,
    catalog: createCatalog({ ctx, client, facts, views, release }),
    availability,
    access,
    release,
    holds: createHolds({
      ctx,
      client,
      facts,
      findFreeUnit: async (externalId, stay, signal, unitIds) =>
        (await availability.check(externalId, stay, { signal, unitIds })).units.find(
          (u) => u.fullyAvailable
        )?.unitId,
    }),
    auth: createParkStayAuth(options.endpoints),
    dispose: async () => access.dispose(),
  };
}

export const parkstayFactory = defineProvider(parkstayManifest, (ctx) =>
  createParkStayModules(ctx)
);
