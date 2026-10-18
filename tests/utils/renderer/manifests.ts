/**
 * Provider manifests for renderer tests: ParkStay as main registers it (stay fields and all;
 * tests/unit/renderer/mock-manifests.test.ts pins it to the real manifest), and a second,
 * fake provider for multi-provider behaviour (the master plan's "fake second provider").
 */
import type { ProviderManifest } from '../../../src/shared/types/provider.types';

/** The ParkStay manifest (architecture-notes §3), as `providers.list()` returns it. */
export const PARKSTAY_MANIFEST: ProviderManifest = {
  id: 'parkstay',
  name: 'ParkStay WA',
  shortName: 'ParkStay',
  description: "Campgrounds in Western Australia's national parks",
  website: 'https://parkstay.dbca.wa.gov.au',
  integration: 'api',
  brand: { color: '#2F6B3A', monogram: 'PS' }, // token-guard-ignore: provider brand data
  locationKinds: ['campground'],
  timezone: 'Australia/Perth',
  currency: 'AUD',
  capabilities: {
    catalog: true,
    catalogMode: 'full',
    availability: true,
    bulkAvailability: true,
    watches: true,
    snipes: true,
    holds: true,
    bookingImport: false,
    accessGate: true,
    account: 'optional',
  },
  limits: { minWatchIntervalMinutes: 15, maxConcurrentRequests: 4, catalogTtlHours: 24 },
  bulkAvailabilityStayFields: ['arrival', 'departure', 'equipment', 'params.gearType'],
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
  releaseModes: [
    {
      id: 'daily_rollover',
      label: 'When new dates open',
      description:
        "Each day ParkStay opens one more date, 180 days ahead, at the campground's release time.",
      usesAccessGate: true,
    },
    {
      id: 'scheduled',
      label: 'At a scheduled time',
      description:
        'For campgrounds whose dates are released in blocks (such as Ningaloo), at a time you set.',
      usesAccessGate: true,
    },
    {
      id: 'cancellation',
      label: 'When someone cancels',
      description: 'Keeps checking for a site that comes free.',
      usesAccessGate: false,
    },
  ],
};

/** A second provider: watches but no holds, no account and no stay fields of its own. */
export const FAKE_MANIFEST: ProviderManifest = {
  id: 'fakestay',
  name: 'Fake Stay Holidays',
  shortName: 'Fake Stay',
  description: 'Holiday parks for testing more than one provider',
  website: 'https://fake.example.com',
  integration: 'api',
  brand: { color: '#5A3E8C', monogram: 'FS' }, // token-guard-ignore: provider brand data
  locationKinds: ['holiday-park'],
  timezone: 'Australia/Perth',
  currency: 'AUD',
  capabilities: {
    catalog: true,
    catalogMode: 'full',
    availability: true,
    bulkAvailability: false,
    watches: true,
    snipes: false,
    holds: false,
    bookingImport: false,
    accessGate: false,
    account: 'none',
  },
};

/** A provider that offers neither watches nor holds: never listed by a watch flow. */
export const BROWSE_ONLY_MANIFEST: ProviderManifest = {
  ...FAKE_MANIFEST,
  id: 'browseonly',
  name: 'Browse Only',
  shortName: 'Browse Only',
  brand: { color: '#1F5F7A', monogram: 'BO' }, // token-guard-ignore: provider brand data
  capabilities: { ...FAKE_MANIFEST.capabilities, watches: false },
};

/** NewBook's 15 equipment types, as RAC's manifest lists them (R19). */
const RAC_EQUIPMENT_TYPES = [
  { value: '2', label: 'Caravan Without Awning' },
  { value: '1', label: 'Caravan with Awning' },
  { value: '15', label: 'Caravan with Slideout' },
  { value: '3', label: 'Campervan' },
  { value: '10', label: 'Motorhome' },
  { value: '12', label: 'Rooftop Tent' },
  { value: '4', label: 'Camper Trailer 2 berth (Small)' },
  { value: '5', label: 'Camper Trailer 4 berth (Medium)' },
  { value: '6', label: 'Camper Trailer 6+ berth (Large)' },
  { value: '13', label: 'Car and Single Room Tent (Small)' },
  { value: '7', label: 'Car and Multiroom Tent (large)' },
  { value: '11', label: 'Car & Swag (with trailer)' },
  { value: '14', label: 'Car & Swag (NO trailer)' },
  { value: '8', label: '5th Wheeler' },
  { value: '9', label: 'Bus' },
];

/**
 * RAC Parks & Resorts as main registers it (tests/unit/renderer/mock-manifests.test.ts pins it
 * to the real manifest): free counts on Explore, watches with no holds, the pets stay field and
 * the hold-only equipment fields, its terms' limits, and the auto-cart experiment, off (R19).
 */
export const RAC_MANIFEST: ProviderManifest = {
  id: 'rac',
  name: 'RAC Parks & Resorts',
  shortName: 'RAC',
  description: 'Holiday parks and resorts across Western Australia, from RAC Parks & Resorts.',
  website: 'https://parksandresorts.rac.com.au',
  integration: 'api',
  brand: { color: '#3A3F47', monogram: 'RAC' }, // token-guard-ignore: provider brand data
  locationKinds: ['holiday-park'],
  timezone: 'Australia/Perth',
  currency: 'AUD',
  capabilities: {
    catalog: true,
    catalogMode: 'full',
    availability: true,
    bulkAvailability: true,
    watches: true,
    snipes: true,
    holds: false,
    bookingImport: false,
    accessGate: false,
    account: 'optional',
  },
  limits: {
    minWatchIntervalMinutes: 15,
    maxConcurrentRequests: 1,
    minRequestIntervalMs: 10_000,
    catalogTtlHours: 24,
  },
  stayFields: [
    {
      key: 'pets',
      label: 'Pets',
      help: 'Up to 2, where pets are allowed.',
      type: 'number',
      min: 0,
      max: 2,
      default: 0,
      appliesTo: ['availability', 'watch', 'snipe'],
    },
    {
      key: 'equipmentType',
      label: 'Equipment',
      help: 'For a site: what you are bringing. RAC fits the site to it.',
      type: 'select',
      options: [{ value: '', label: 'None (a cabin or a room)' }, ...RAC_EQUIPMENT_TYPES],
      appliesTo: ['hold'],
    },
    {
      key: 'equipmentLength',
      label: 'Equipment length (metres)',
      help: 'For a site, such as 6.5.',
      type: 'text',
      pattern: String.raw`\d{1,2}(?:\.\d{1,2})?`,
      appliesTo: ['hold'],
    },
    {
      key: 'equipmentWidth',
      label: 'Equipment width (metres)',
      help: 'For a site, such as 2.5.',
      type: 'text',
      pattern: String.raw`\d{1,2}(?:\.\d{1,2})?`,
      appliesTo: ['hold'],
    },
  ],
  bulkAvailabilityStayFields: [
    'arrival',
    'departure',
    'adults',
    'children',
    'infants',
    'params.pets',
  ],
  releaseModes: [
    {
      id: 'daily_rollover',
      label: 'When these dates open',
      description:
        'New dates open each midnight, 364 days ahead, and school holidays on their own release ' +
        'days. Site Sniper works out when yours open and checks then.',
      usesAccessGate: false,
      maxWindowMinutes: 30,
    },
    {
      id: 'scheduled',
      label: 'At a time you set',
      description:
        "For dates released on a day you know, such as Cable Beach's dry-season dates. " +
        'Site Sniper checks from the time you set.',
      usesAccessGate: false,
      maxWindowMinutes: 30,
    },
  ],
  experiments: [
    {
      id: 'autoCart',
      label: 'Put stays in my RAC cart automatically',
      description:
        'When a watch or a snipe finds your stay, WA Stay adds it to your RAC cart. ' +
        "You check out and pay on RAC's own page.",
      warning:
        'Experimental: not yet checked with a real booking. A cart is not a booking: ' +
        'only a paid booking secures your stay.',
      turnsOn: ['holds'],
    },
  ],
  holdRelease: true,
};

/** RAC as main registers it with auto-cart turned on (`withExperiments`): holds on, applied. */
export const RAC_AUTO_CART_MANIFEST: ProviderManifest = {
  ...RAC_MANIFEST,
  capabilities: { ...RAC_MANIFEST.capabilities, holds: true },
  experiments: RAC_MANIFEST.experiments!.map((experiment) => ({ ...experiment, applied: true })),
};

/**
 * Stay Rottnest as main registers it (tests/unit/renderer/mock-manifests.test.ts pins it to the
 * real manifest): Explore's free counts and watches, nothing held or booked, its terms' limits,
 * and its notice, which the person accepts before WA Stay checks anything there (§12.36).
 */
export const ROTTNEST_MANIFEST: ProviderManifest = {
  id: 'rottnest',
  name: 'Stay Rottnest',
  shortName: 'Stay Rottnest',
  description:
    "Villas, cottages, cabins, the hostel and camping on Rottnest Island, from the Rottnest Island Authority's Stay Rottnest.",
  website: 'https://www.stayrottnest.com',
  integration: 'api',
  brand: { color: '#9E3819', monogram: 'SR' }, // token-guard-ignore: provider brand data
  locationKinds: ['cabin', 'campground', 'other'],
  timezone: 'Australia/Perth',
  currency: 'AUD',
  capabilities: {
    catalog: true,
    catalogMode: 'full',
    availability: true,
    bulkAvailability: true,
    watches: true,
    snipes: true,
    holds: false,
    bookingImport: false,
    accessGate: false,
    account: 'none',
  },
  limits: {
    minWatchIntervalMinutes: 30,
    maxConcurrentRequests: 1,
    minRequestIntervalMs: 60_000,
    catalogTtlHours: 24,
  },
  releaseModes: [
    {
      id: 'open_day',
      label: 'On its Open Day',
      description:
        "Stay Rottnest opens a whole month of stays at once, at 8:30 am on its Open Day. Site Sniper reminds you before then, so you're in the waiting room in time: you book on Stay Rottnest yourself.",
      usesAccessGate: false,
      remindOnly: true,
      reminders: [
        {
          daysBefore: 1,
          at: '18:00',
          title: 'Open Day tomorrow',
          body: "Stay Rottnest's waiting room opens at 6 am and bookings at 8:30 am, Perth time. Have your mobile for the passcode, your card and your plan ready.",
        },
        {
          daysBefore: 0,
          at: '06:00',
          title: 'The waiting room is open',
          body: "Everyone in Stay Rottnest's waiting room before 8:30 am gets a random place in the queue, so join when it suits you before then.",
        },
        {
          daysBefore: 0,
          at: '08:15',
          title: '15 minutes to Open Day',
          body: "Bookings open at 8:30 am. Join Stay Rottnest's waiting room now if you haven't: after 8:30 you join the back of the queue.",
        },
      ],
      checklist: [
        "Your choices in order: the room types and precincts you'd take, best first.",
        'Dates that can move a little, in case your first choice goes.',
        'Everyone in your party, within what the room type sleeps.',
        'Your Stay Rottnest profile, with your details up to date.',
        "Your own mobile, for the waiting room's passcode. Temporary or virtual numbers aren't accepted.",
        'A Visa or Mastercard.',
        'For a second unit in your name, a keyholder to nominate.',
        'Only what you need: everyone else in the queue is hoping too.',
      ],
    },
  ],
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
