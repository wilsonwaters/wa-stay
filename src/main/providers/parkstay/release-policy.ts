/**
 * When ParkStay releases a stay for booking (architecture-notes §12.3; PQ3), for Site Sniper:
 *
 * - `daily_rollover`: each campground takes bookings `max_advance_booking` days ahead (180).
 *   A new arrival date opens every day at the campground's own release time, Perth time
 *   (`api.py:1358-1372`): Bungarra's `release_time_friendly` is `02:00 AM`. The time is read
 *   from `campsite_availablity_view` and kept in the provider state as `release.time.<id>`;
 *   until it is known, 00:00 is assumed. When a campground's view has none (one not booked
 *   online), the policy does not fetch the view again to look for it for an hour.
 * - `scheduled`: dates released in blocks (a release period, such as Ningaloo's), at a time
 *   the person sets. `suggestScheduledAt` offers the next first Tuesday at 10:00 AWST.
 * - `cancellation`: no release; poll continuously.
 *
 * `releaseHorizon` is the same rule for availability: which nights of a stay are not
 * released yet.
 */

import { addDays, todayIn, zonedInstant } from '@shared/utils/calendar-date';
import { SnipeReleaseMode } from '@shared/types/common.types';
import { MIN_SNIPE_POLL_INTERVAL_MS, CANCELLATION_POLL_MIN_MS } from '@shared/constants';
import type { ProviderId } from '@shared/types/provider.types';
import { isAbortError, ProviderError, throwIfAborted } from '../sdk/errors';
import type { KeyValueStore } from '../sdk/kv-store';
import type { ProviderLogger } from '../sdk/context';
import type { ReleaseComputeInput, ReleaseModeId, ReleasePolicy } from '../sdk/provider';
import type { CampgroundFacts } from './catalog';
import { DEFAULT_MAX_ADVANCE_DAYS } from './constants';

/** A time of day, Perth time. */
export interface TimeOfDay {
  hour: number;
  minute: number;
}

const MODES: readonly ReleaseModeId[] = [
  SnipeReleaseMode.DAILY_ROLLOVER,
  SnipeReleaseMode.SCHEDULED,
  SnipeReleaseMode.CANCELLATION,
];

const MIDNIGHT: TimeOfDay = { hour: 0, minute: 0 };

/** Where a campground's release time is kept in the provider state. */
export const releaseTimeKey = (externalId: string): string => `release.time.${externalId}`;

/** How long a view without a release time stops the policy fetching the view for one. */
export const NO_RELEASE_TIME_TTL_MS = 3_600_000;

/** `02:00 AM` → 2:00, `12:00 AM` → 0:00, `10:30 PM` → 22:30. Undefined when unreadable. */
export function parseReleaseTime(friendly: string | null | undefined): TimeOfDay | undefined {
  const match = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])\s*$/.exec(friendly ?? '');
  if (!match) return undefined;
  const [hour12, minute] = [Number(match[1]), Number(match[2])];
  if (hour12 < 1 || hour12 > 12 || minute > 59) return undefined;
  const pm = match[3].toLowerCase() === 'pm';
  return { hour: (hour12 % 12) + (pm ? 12 : 0), minute };
}

/** `{ hour: 2, minute: 0 }` → `2:00 am`; midnight is `12:00 am`. */
export function formatTimeOfDay({ hour, minute }: TimeOfDay): string {
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `2027-03-31` → `31 March 2027`. */
export function formatCalendarDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** The next first Tuesday of a month at 10:00 in `timeZone`, strictly after `from`. */
export function nextFirstTuesdayAt10(from: Date, timeZone: string): Date {
  const [year, month] = todayIn(timeZone, from).split('-').map(Number);
  for (let i = 0; i < 24; i++) {
    const y = year + Math.floor((month - 1 + i) / 12);
    const m = ((month - 1 + i) % 12) + 1;
    const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const day = 1 + ((2 - firstWeekday + 7) % 7);
    const date = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const candidate = zonedInstant(date, { hour: 10, minute: 0 }, timeZone);
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  throw new RangeError('No first Tuesday in the next two years');
}

export interface HorizonInput {
  /** The night being asked about, `YYYY-MM-DD`. */
  date: string;
  /** Today where the campground is. */
  today: string;
  maxAdvanceDays: number;
  /** `release_date`: set during a release period. */
  releaseDate?: string | null;
  /** `booking_time_open`: false while the furthest date's release time has not come. */
  bookingTimeOpen?: boolean;
}

/**
 * Whether ParkStay has released the night `date` yet:
 * - during a release period (`release_date` set), that date and every later one are closed
 *   until the next block (`booking_availability.py:598-601`);
 * - otherwise the furthest bookable date is today + `max_advance_booking`; it opens at the
 *   campground's release time (`booking_time_open`), and later dates are not released.
 */
export function isReleased({
  date,
  today,
  maxAdvanceDays,
  releaseDate,
  bookingTimeOpen,
}: HorizonInput): boolean {
  if (releaseDate) return date < releaseDate;
  const horizon = addDays(today, maxAdvanceDays);
  if (date < horizon) return true;
  return date === horizon && bookingTimeOpen !== false;
}

export interface ReleasePolicyDeps {
  providerId: ProviderId;
  state: KeyValueStore;
  facts: CampgroundFacts;
  timeZone: string;
  logger: ProviderLogger;
  clock: () => Date;
  /** Fetches the campground's availability view, recording its release facts. */
  loadView?: (externalId: string, signal?: AbortSignal) => Promise<void>;
}

export class ParkStayReleasePolicy implements ReleasePolicy {
  readonly pollFloorMs = Object.freeze({
    window: MIN_SNIPE_POLL_INTERVAL_MS,
    continuous: CANCELLATION_POLL_MIN_MS,
  });

  /** Release times already in the provider state, so a poll does not rewrite them. */
  private readonly knownTimes = new Map<string, string>();
  /** When a campground's view last came without a readable release time (epoch ms). */
  private readonly noTimeSince = new Map<string, number>();

  constructor(private readonly deps: ReleasePolicyDeps) {}

  supports(mode: ReleaseModeId): boolean {
    return MODES.includes(mode);
  }

  async computeReleaseAt(input: ReleaseComputeInput): Promise<Date | null> {
    const { mode, externalId, stay, requestedAt, signal } = input;
    throwIfAborted(signal);
    switch (mode) {
      case SnipeReleaseMode.CANCELLATION:
        return null;
      case SnipeReleaseMode.SCHEDULED:
        if (!requestedAt) {
          throw new ProviderError({
            providerId: this.deps.providerId,
            message: 'A scheduled release needs the time the dates are released',
          });
        }
        return requestedAt;
      case SnipeReleaseMode.DAILY_ROLLOVER: {
        const time = await this.releaseTimeOrLoad(externalId, signal);
        const maxAdvance =
          this.deps.facts.maxAdvanceBooking(externalId) ?? DEFAULT_MAX_ADVANCE_DAYS;
        const releaseDay = addDays(stay.arrival, -maxAdvance);
        return zonedInstant(releaseDay, time ?? MIDNIGHT, this.deps.timeZone);
      }
      default:
        throw new ProviderError({
          providerId: this.deps.providerId,
          message: `${this.deps.providerId}: unknown release mode "${mode}"`,
        });
    }
  }

  async describe(externalId: string, signal?: AbortSignal): Promise<string | undefined> {
    throwIfAborted(signal);
    const { facts } = this.deps;
    const type = facts.campgroundType(externalId);
    // Only campgrounds bookable online have releases.
    if (type !== undefined && type !== 0) return undefined;
    if (!facts.view(externalId) && this.deps.loadView) {
      await this.deps.loadView(externalId, signal);
    }
    const view = facts.view(externalId);
    if (view?.releaseDate) {
      return `Bookable up to ${formatCalendarDay(addDays(view.releaseDate, -1))}; later dates are released in blocks — use a scheduled snipe`;
    }
    const maxAdvance = facts.maxAdvanceBooking(externalId) ?? DEFAULT_MAX_ADVANCE_DAYS;
    const time = (await this.releaseTime(externalId)) ?? MIDNIGHT;
    throwIfAborted(signal);
    return `Bookings open ${maxAdvance} days ahead at ${formatTimeOfDay(time)} AWST`;
  }

  suggestScheduledAt(_externalId: string, now: Date): Date | null {
    return nextFirstTuesdayAt10(now, this.deps.timeZone);
  }

  /** The campground's release time from the provider state, if it is known. */
  async releaseTime(externalId: string): Promise<TimeOfDay | undefined> {
    const known = this.knownTimes.get(externalId);
    const stored = known ?? (await this.deps.state.get<string>(releaseTimeKey(externalId)));
    if (typeof stored !== 'string') return undefined;
    this.knownTimes.set(externalId, stored);
    const [hour, minute] = stored.split(':').map(Number);
    return Number.isInteger(hour) && Number.isInteger(minute) ? { hour, minute } : undefined;
  }

  /**
   * Records `release_time_friendly` from an availability view; stored only when it changes.
   * A view without a readable one is remembered for `NO_RELEASE_TIME_TTL_MS`.
   */
  async rememberReleaseTime(
    externalId: string,
    friendly: string | null | undefined
  ): Promise<void> {
    const time = parseReleaseTime(friendly);
    if (!time) {
      this.noTimeSince.set(externalId, this.deps.clock().getTime());
      return;
    }
    this.noTimeSince.delete(externalId);
    const value = `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
    if (this.knownTimes.get(externalId) === value) return;
    this.knownTimes.set(externalId, value);
    await this.deps.state.set(releaseTimeKey(externalId), value);
  }

  /**
   * The release time, fetching the campground's view once when it is not known yet, unless a
   * view read within the last hour had none.
   */
  private async releaseTimeOrLoad(
    externalId: string,
    signal?: AbortSignal
  ): Promise<TimeOfDay | undefined> {
    let time = await this.releaseTime(externalId);
    throwIfAborted(signal);
    if (time || !this.deps.loadView || this.recentlyWithoutTime(externalId)) return time;
    try {
      await this.deps.loadView(externalId, signal);
      time = await this.releaseTime(externalId);
    } catch (error) {
      if (isAbortError(error)) throw error;
      this.deps.logger.warn(
        `ParkStay campground ${externalId}: release time unknown, assuming midnight`,
        error instanceof Error ? error.message : String(error)
      );
    }
    throwIfAborted(signal);
    return time;
  }

  private recentlyWithoutTime(externalId: string): boolean {
    const since = this.noTimeSince.get(externalId);
    return since !== undefined && this.deps.clock().getTime() - since < NO_RELEASE_TIME_TTL_MS;
  }

  /** Today where ParkStay is. */
  today(): string {
    return todayIn(this.deps.timeZone, this.deps.clock());
  }
}
