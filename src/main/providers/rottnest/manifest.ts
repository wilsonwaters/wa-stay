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
 * the background, watches every 30 minutes at most. Before WA Stay sends Stay Rottnest
 * anything, each person reads and accepts the notice below (§9.1): the core sends nothing
 * until then (architecture-notes §12.36).
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
  // Clause 4's words and what they mean for the person, before the first request (terms review
  // §9.1). A change to what it says raises the version, so everyone reads it again.
  notice: {
    version: 1,
    title: 'Before WA Stay checks Stay Rottnest',
    body:
      "Stay Rottnest's booking terms (clause 4, Use of Automated Software) say bookings may not be made or assisted by automated software, including programs used for web scraping or rate shopping.\n\n" +
      'WA Stay checks Stay Rottnest automatically, so a booking you make after one of its checks or alerts could count as assisted.',
    points: [
      'If the Rottnest Island Authority reasonably suspects a booking was made with the help of automated software, it may cancel the booking without a refund, and block your internet connection from its website.',
      'WA Stay only looks: it checks from your computer and your internet connection, a watch at most every 30 minutes, and it never holds, books or signs in for you. You book on Stay Rottnest yourself.',
      'It does not check on Open Day mornings, and stops for at least 12 hours if Stay Rottnest turns a check away.',
      "The risk is yours to take. If you'd rather not, book on Stay Rottnest's own website: WA Stay still shows its places and links to them.",
      'You can withdraw this in Settings, under Accounts, at any time, and WA Stay stops checking at once.',
    ],
    confirmLabel: 'I understand, and I want WA Stay to check Stay Rottnest for me',
  },
};
