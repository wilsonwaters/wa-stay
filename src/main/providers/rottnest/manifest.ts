/**
 * Stay Rottnest: who the provider is and what it can do. The registry validates this manifest,
 * and the renderer and the core services read everything about the provider from it: no other
 * code in the app names it.
 *
 * Rottnest Island's precincts are on Explore, each with its room types; a stay's availability
 * is checked on the place page and for Explore's free counts, and watches run on it, all from
 * one search of Stay Rottnest's results page for the island (`availability.ts`). Nothing holds,
 * carts or books: the person books on Stay Rottnest's own site. The stakeholder chose this
 * knowing clause 4 of Stay Rottnest's terms (automated software; `ai-state/research/rottnest-
 * terms.md` §9), and its limits are the terms review's: one request at a time, 60 s apart in
 * the background, watches every 30 minutes at most.
 */

import type { ProviderManifest } from '@shared/types/provider.types';
import { ROTTNEST_SITE_URL } from './links';

export const ROTTNEST_PROVIDER_ID = 'rottnest';

export const rottnestManifest: ProviderManifest = {
  // Stored in every watch, snipe, booking and notification, so it never changes once shipped.
  id: ROTTNEST_PROVIDER_ID,
  // The booking service's own name, as people know it ("Search on Stay Rottnest").
  name: 'Stay Rottnest',
  shortName: 'Stay Rottnest',
  description:
    "Villas, cottages, cabins, the hostel and camping on Rottnest Island, from the Rottnest Island Authority's Stay Rottnest.",
  website: ROTTNEST_SITE_URL,
  integration: 'api',
  // A plain text monogram, never RIA's logo, on the app's coral (`--ws-coral-700`): apart from
  // ParkStay's green and RAC's slate. White on it passes WCAG AA.
  brand: { color: '#9E3819', monogram: 'SR' },
  // Self-contained precincts are cabins, the Campground a campground, Kingstown "a place to stay"
  locationKinds: ['cabin', 'campground', 'other'],
  timezone: 'Australia/Perth',
  currency: 'AUD',
  capabilities: {
    // The nine precincts from the seed (`precincts.ts`), each room type a unit.
    catalog: true,
    catalogMode: 'full',
    // One search answers for every room type on the island, for the whole stay.
    availability: true,
    // Explore's free counts: the same search, one entry per precinct.
    bulkAvailability: true,
    watches: true,
    // Open Day plans (reminders) come with the Open Day calendar; never a release-instant check.
    snipes: false,
    // Never: no hold, cart or booking on Stay Rottnest (terms review §9.2).
    holds: false,
    bookingImport: false,
    // The Open Day waiting room is the person's, in their own browser: WA Stay never enters it.
    accessGate: false,
    // No Stay Rottnest account: the checks are anonymous (§9.6).
    account: 'none',
  },
  limits: {
    // The stakeholder's minimum (decision T1).
    minWatchIntervalMinutes: 30,
    // One request at a time, at least 60 s apart in the background (§9.3).
    maxConcurrentRequests: 1,
    minRequestIntervalMs: 60_000,
    // The precincts are a seed; nothing is fetched when the catalogue syncs.
    catalogTtlHours: 24,
  },
};
