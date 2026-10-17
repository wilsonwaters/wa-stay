/**
 * RAC Parks & Resorts: who the provider is and what it can do. The registry validates this
 * manifest, and the renderer and the core services read everything about the provider from it:
 * no other code in the app names it.
 *
 * The parks are on Explore with their categories (the catalogue) and their free units for the
 * dates Explore is given, each park's availability for a stay is checked per category, watches
 * run on it, and Site Sniper alerts when a stay's dates open (snipes without holds). The account
 * is optional: the person's own RAC member number, saved in the app, brings members' rates and
 * the member pre-sale's times. Every other capability is off. RAC's terms (`index.ts`) set
 * the limits: one request at a time, 10 s apart in the background, watches every 15 minutes at
 * most, a snipe's checks 10 s apart for at most 30 minutes after the release, and at most two
 * pets.
 */

import { SnipeReleaseMode } from '@shared/types/common.types';
import type { ProviderManifest } from '@shared/types/provider.types';
import { RAC_SITE_URL } from './client';

export const RAC_PROVIDER_ID = 'rac';

/**
 * How long a snipe keeps checking after its release, in minutes: every release mode's
 * `maxWindowMinutes`. The rolling window's exact opening moment is unmeasured (closed at 23:42,
 * open at 00:01:40), so checking from midnight for 30 minutes covers it.
 */
export const RAC_SNIPE_WINDOW_MINUTES = 30;

export const racManifest: ProviderManifest = {
  // Stored in every watch, snipe, booking and notification, so it never changes once shipped.
  id: RAC_PROVIDER_ID,
  name: 'RAC Parks & Resorts',
  // "Book on RAC"; also starts its desktop notifications.
  shortName: 'RAC',
  description: 'Holiday parks and resorts across Western Australia, from RAC Parks & Resorts.',
  website: RAC_SITE_URL,
  integration: 'api',
  // A plain text monogram, never RAC's logo, on the app's dark slate (`--ws-ink-700`): neither
  // RAC's own blue nor its yellow, and apart from ParkStay's green. White on it passes WCAG AA.
  brand: { color: '#3A3F47', monogram: 'RAC' },
  locationKinds: ['holiday-park'],
  timezone: 'Australia/Perth',
  currency: 'AUD',
  capabilities: {
    // The eight open parks from the seed (`parks.ts`), and each park's categories as units.
    catalog: true,
    catalogMode: 'full',
    // One POST per park and stay, every category's nights and prices (`availability.ts`).
    availability: true,
    // Explore's free counts: one POST per park, free units only, no total (`bulk.ts`).
    bulkAvailability: true,
    watches: true,
    // Release alerts: a snipe checks when the dates open and alerts with RAC's booking page.
    snipes: true,
    // Never holds or carts (no live cart): every RAC snipe is an alert.
    holds: false,
    // Never: the app does not cancel or change an RAC booking (terms rule 10).
    bookingImport: false,
    accessGate: false,
    // The person's own member number, saved in Settings → Accounts (`auth.ts`): optional, and
    // nothing waits on it (members' rates and pre-sale times with it, public ones without)
    account: 'optional',
  },
  limits: {
    // Terms rule 3: no faster than ParkStay's watches.
    minWatchIntervalMinutes: 15,
    // Terms rules 2 and 4: one request at a time, at least 10 s apart (robots.txt asks for it).
    maxConcurrentRequests: 1,
    minRequestIntervalMs: 10_000,
    // The parks are a seed; nothing is fetched when the catalogue syncs.
    catalogTtlHours: 24,
  },
  stayFields: [
    {
      // Sent as RAC's `animals`; a category that takes no pets refuses a stay with them.
      key: 'pets',
      label: 'Pets',
      help: 'Up to 2, where pets are allowed.',
      type: 'number',
      min: 0,
      // Terms rule 16: a booking takes at most two pets.
      max: 2,
      default: 0,
      appliesTo: ['availability', 'watch', 'snipe'],
    },
  ],
  // What the POST sends: the dates, the party and the pets. A change to any asks again.
  bulkAvailabilityStayFields: [
    'arrival',
    'departure',
    'adults',
    'children',
    'infants',
    'params.pets',
  ],
  // Both timed: a snipe checks every 10 s from the release for at most 30 minutes (terms rules
  // 2 and 3; `release-policy.ts`). No cancellation mode: watches cover cancellations, every 15
  // minutes at most.
  releaseModes: [
    {
      id: SnipeReleaseMode.DAILY_ROLLOVER,
      label: 'When these dates open',
      description:
        'New dates open each midnight, 364 days ahead, and school holidays on their own release ' +
        'days. Site Sniper works out when yours open and checks then.',
      usesAccessGate: false,
      maxWindowMinutes: RAC_SNIPE_WINDOW_MINUTES,
    },
    {
      id: SnipeReleaseMode.SCHEDULED,
      label: 'At a time you set',
      description:
        "For dates released on a day you know, such as Cable Beach's dry-season dates. " +
        'Site Sniper checks from the time you set.',
      usesAccessGate: false,
      maxWindowMinutes: RAC_SNIPE_WINDOW_MINUTES,
    },
  ],
};
