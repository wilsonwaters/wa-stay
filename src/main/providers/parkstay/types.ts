/**
 * Raw ParkStay and DBCA queue response shapes, as the endpoints return them (checked live on
 * 2 Oct 2026 and against the DBCA backend, `dbca-wa/parkstay_bs_v2`). They stay inside the
 * ParkStay module: the rest of the app sees only the SDK's normalised types.
 */

/** `GET /api/campground_map/`: a GeoJSON FeatureCollection of every campground. */
export interface RawCampgroundMap {
  type: 'FeatureCollection';
  features: RawCampgroundFeature[];
}

export interface RawCampgroundFeature {
  type: 'Feature';
  id: number;
  /** `[lng, lat]`. */
  geometry: { type: 'Point'; coordinates: [number, number] | null } | null;
  properties: {
    name: string;
    /** 0 bookable online, 1 not online, 2 other operator, 4 by application. */
    campground_type: number;
    max_advance_booking: number;
    /** Empty for every campground. */
    description: string;
    features: Array<{ id: number; name: string; description?: string; image?: string | null }>;
    /** Site-relative (`/media/parkstay/campground_images/…`). */
    images: Array<{ image: string }>;
    info_url: string;
    park: {
      id: number;
      name: string;
      district: { id: number; name: string; region: { id: number; name: string } };
      entry_fee_required?: boolean;
    };
    price_hint: unknown;
    campsites: Array<{
      id: number;
      name: string;
      tent: boolean;
      campervan: boolean;
      caravan: boolean;
      max_people: number;
      max_vehicles: number;
      description: string;
    }>;
  };
}

/**
 * One night of a site in `campsite_availablity_view` (`api.py:1550`):
 * `[bookable, label, price, _, _, date]`. The label is `$30.00` when bookable, otherwise
 * `Unavailable` (or `Booked`, `Closed`… for staff); the price is a decimal string; the date
 * is `YYYY-MM-DD`. For a campsite class (`site-classes.ts`), `counts` is
 * `[booked, closed, other]` sites while no site is free for the whole stay.
 */
export type RawNightTuple = [
  bookable: boolean,
  label: string,
  price: string | number | null,
  reason: unknown,
  counts: unknown,
  date: string,
];

/** One night of one site in a class's `breakdown`: `[free, label, price, _]`, by offset. */
export type RawBreakdownNight = [
  free: boolean,
  label: string,
  price: string | number | null,
  reason: unknown,
];

export interface RawCampsite {
  /** The site, or (class listings) one site of the class, which changes between polls. */
  id: number;
  /** The site's name, or (class listings) the class's name. */
  name: string;
  /** The campground type, or (class listings) the campsite class id. */
  type: number;
  /** The campsite class id, or null. A key of `classes`. */
  class?: number | null;
  price: string | false;
  availability: RawNightTuple[];
  gearType: Record<string, boolean>;
  features: unknown[];
  min_people: number;
  max_people: number;
  max_vehicles: number;
  /** Always the placeholder `"x"`: never shown. */
  description?: string;
  /** The site card's paragraph: plain text, at most 310 characters, or null. */
  short_description?: string | null;
  /**
   * Class listings, while no site is free for the whole stay: each site of the class by name,
   * with its nights in the order of `availability`. Empty otherwise.
   */
  breakdown?: Array<{ name: string; availability: RawBreakdownNight[] }>;
  /** Class listings: how many sites are free for the whole stay, when some are. */
  site_left?: string;
}

/** `GET /api/campsite_availablity_view/{id}/` (`api.py:1217-1590`). */
export interface RawCampsiteAvailabilityView {
  id: number;
  name: string;
  /** 0 lists each site; 1 and 2 list campsite classes. */
  site_type?: number;
  /** Only on a campground that is not bookable online (`not_bookable_online`). */
  campground_type?: number;
  long_description: string;
  map: string | null;
  ongoing_booking: boolean;
  ongoing_booking_id: number | null;
  /** `YYYY/MM/DD` */
  arrival: string;
  days: number;
  sites: RawCampsite[];
  /** Class id (`"null"` for none) → class name. `{ "null": null }` means no classes. */
  classes: Record<string, string | null>;
  /** e.g. `02:00 AM`: when the next date opens, Perth time. */
  release_time_friendly?: string;
  /** `YYYY-MM-DD`: when set, this date and later are closed until the next release. */
  release_date?: string | null;
  booking_open_date?: string | null;
  /** False when the stay starts on the furthest bookable date and its release time has not come. */
  booking_time_open?: boolean;
}

/** `GET /api/campground_availabilty_view/` (`api.py`): every campground in one call. */
export interface RawBulkAvailability {
  campground: unknown;
  campground_available: Record<
    string,
    { sites: number[]; total_available?: number; total_bookable?: number }
  >;
  available_cg: Array<{ id: number }>;
}

/** `POST /api/create_booking` (`api.py:2938-3380`). */
export interface RawCreateBookingResponse {
  status: 'success' | 'error';
  pk?: number;
  /** A string, or `{ title?, error }`, or the repr of a validation error. */
  msg?: unknown;
  inprogress_booking?: boolean;
}

/**
 * `GET queue.dbca.wa.gov.au/api/check-create-session/` (fields checked live 2026-04-06).
 * `queue_position` is null while `Active`.
 */
export interface QueueApiResponse {
  status: 'Active' | 'Waiting';
  session_key: string;
  queue_position: number | null;
  wait_time: number;
  expiry_seconds: number;
  session?: string;
  idle_seconds?: number;
  idle?: string;
  expiry?: string;
  total_active_session?: number;
  total_waiting_session?: number;
  new_session?: boolean;
  queue_full?: boolean;
  queue_position_epoch?: number;
  activated_session_id?: string;
  time_left_enabled?: boolean;
  show_queue_position?: boolean;
  browser_inactivity_timeout?: number;
  browser_inactivity_redirect?: string;
  browser_inactivity_enabled?: boolean;
  waiting_queue_enabled?: boolean;
  wq?: boolean;
  custom_message?: string;
  queue_name?: string;
  more_info_link?: string;
  max_queue_session_limit?: number | string;
  max_queue_url_redirect?: string;
  queue_waiting_room_url?: string;
  queue_inactivity_url?: string;
  queueurl?: string;
  url?: string;
  refresh_page?: boolean;
}
