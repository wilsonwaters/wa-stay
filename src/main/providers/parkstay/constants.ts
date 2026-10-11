/**
 * ParkStay WA (DBCA) constants. The URLs, the queue group and the hold length moved here
 * from `shared/constants/app-constants.ts` unchanged: the DBCA queue identifies this app's
 * sessions by them, so they must not change.
 */

export const PARKSTAY_PROVIDER_ID = 'parkstay';

/** The ParkStay site: links, images and the `Referer`/`Origin` the API expects. */
export const PARKSTAY_BASE_URL = 'https://parkstay.dbca.wa.gov.au';
export const PARKSTAY_API_BASE_URL = 'https://parkstay.dbca.wa.gov.au/api';

/** The DBCA virtual queue in front of ParkStay. */
export const QUEUE_API_BASE_URL = 'https://queue.dbca.wa.gov.au';
export const QUEUE_GROUP = 'parkstayv2';

/** How long a `create_booking` hold lasts. */
export const HOLD_MINUTES = 30;

/** ParkStay's booking numbers: `PB` + the booking pk (`BOOKING_PREFIX`, `models.py`). */
export const BOOKING_PREFIX = 'PB';

/**
 * Top-level origins the payment window may show: ParkStay, and DBCA's own hosts (the
 * payment ledger and its pages). Card and 3-D Secure frames are subframes, which the window
 * does not restrict (PQ5).
 */
export const PAYMENT_ORIGINS: readonly string[] = [PARKSTAY_BASE_URL, 'https://*.dbca.wa.gov.au'];

/**
 * The queue session cookie. The queue middleware and the queue site set it on the parent
 * domain, so it is sent to both `parkstay.` and `queue.dbca.wa.gov.au`.
 */
export const QUEUE_COOKIE_NAME = 'sitequeuesession';
export const QUEUE_COOKIE_DOMAIN = 'dbca.wa.gov.au';

/** How far ahead a campground takes bookings when the catalogue has not said otherwise. */
export const DEFAULT_MAX_ADVANCE_DAYS = 180;
