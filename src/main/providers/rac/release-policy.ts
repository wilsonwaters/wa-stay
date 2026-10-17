/**
 * When RAC releases a stay, for Site Sniper (`ReleasePolicy`) and for availability's
 * `release.opensAt`. It sends no request: it reads only the release calendar
 * (`release-calendar.ts`), the park facts (`parks.ts`), the clock (`now`) and `isMember()`.
 *
 * - `daily_rollover`: the later of two instants, Perth time.
 *   - **The rolling window.** RAC takes bookings up to 364 days ahead, and a new night opens at
 *     midnight Perth time each day (`ai-state/research/rac-booking-flow.md` §4). A stay can be
 *     booked once its last night (departure − 1) is open, so it opens at 00:00 on departure −
 *     365.
 *   - **A school-holiday release.** When a night of the stay is in an announced period and the
 *     park is in RAC's school-holiday releases, the period's public release at the park's hour.
 *     With a member number (`isMember()`), at a park in the member pre-sale, for a snipe that
 *     wants a category in it (any, when it names none; Margaret River's dorms are not), the
 *     pre-sale instead: the same hour, 48 hours earlier (terms rule 14). A stay touching two
 *     periods takes the later release. Cable Beach is in no school-holiday release: only the
 *     rolling window applies there, member number or not, outside its dry season.
 *
 *   A snipe keeps checking for its window after its release (`windowMs`: its own choice, at
 *   most `RAC_SNIPE_WINDOW_MINUTES`, 30; the 30 minutes when none is given). When that window
 *   has passed for the member instant, but not for the public one, the public instant is
 *   used (a member who missed the pre-sale still gets the public release). When every window
 *   has passed, the stay is refused: the dates are open already, and a watch suits them.
 * - `scheduled`: the time the person sets, for releases the calendar does not know (Cable
 *   Beach's dry-season dates). Refused without one.
 *
 * A refusal is a `ProviderError`, which the core shows on the snipe's release time:
 * - a night in a park's own seasonal release (`RacPark.seasonalRelease`: Cable Beach's dry
 *   season, 15 May to 15 October), whose release days WA Stay does not know;
 * - a night in a school-holiday period RAC has not announced, at a park in the releases;
 * - a night after `CALENDAR_COVERS_UNTIL`, at such a park;
 * - every window has passed.
 *
 * `isMember()` is asked at every daily-rollover compute and never kept, so a member number saved
 * or removed shows at the snipe's next arm; when it fails, the person counts as no member (a
 * warning names no value). There is no `cancellation` mode: watches cover cancellations, every
 * 15 minutes at most.
 */

import { SnipeReleaseMode } from '@shared/types/common.types';
import type { ProviderId, StayQuery, UnitKind } from '@shared/types/provider.types';
import {
  addDays,
  eachNight,
  isCalendarDate,
  zonedInstant,
  type CalendarDate,
} from '@shared/utils/calendar-date';
import type { ProviderLogger } from '../sdk/context';
import { ProviderError, throwIfAborted } from '../sdk/errors';
import type { ReleaseComputeInput, ReleaseModeId, ReleasePolicy } from '../sdk/provider';
import { categoryIdOf } from './links';
import { RAC_SNIPE_WINDOW_MINUTES, racManifest } from './manifest';
import { racPark, type RacPark, type SchoolHolidayRelease, type SeasonalRelease } from './parks';
import { isAnnounced, isCovered, periodOf } from './release-calendar';

/** RAC's time zone: every release day and night is a calendar date there. */
export const RAC_TIME_ZONE = racManifest.timezone;

/** The last bookable night is today + 364 in Perth (research §4). */
export const RAC_WINDOW_DAYS = 364;

/**
 * The fastest a snipe checks inside its window: the gap RAC's robots.txt asks for between
 * requests (`limits.minRequestIntervalMs`, 10 s).
 */
export const RAC_WINDOW_POLL_FLOOR_MS = racManifest.limits?.minRequestIntervalMs ?? 10_000;

/**
 * No mode polls continuously; should one ever, no faster than watches
 * (`limits.minWatchIntervalMinutes`, 15 minutes).
 */
export const RAC_CONTINUOUS_POLL_FLOOR_MS =
  (racManifest.limits?.minWatchIntervalMinutes ?? 15) * 60_000;

const MODES: readonly ReleaseModeId[] = [
  SnipeReleaseMode.DAILY_ROLLOVER,
  SnipeReleaseMode.SCHEDULED,
];

const MIDNIGHT = { hour: 0, minute: 0 };
const WINDOW_MS = RAC_SNIPE_WINDOW_MINUTES * 60_000;

/** The instant a stay's last night comes into the rolling window: 00:00 on departure − 365. */
export function rollingInstant(departure: CalendarDate): Date {
  return zonedInstant(addDays(departure, -(RAC_WINDOW_DAYS + 1)), MIDNIGHT, RAC_TIME_ZONE);
}

/** The instant it is the park's release hour on `day`, Perth time. */
function atParkHour(day: CalendarDate, holidays: SchoolHolidayRelease): Date {
  return zonedInstant(day, { hour: holidays.hour, minute: 0 }, RAC_TIME_ZONE);
}

/** Whether a category (a unit `cat:<id>`, of `kind`) is in the park's member pre-sale. */
export function inPreSale(
  holidays: SchoolHolidayRelease,
  unit: { unitId?: string; unitKind?: UnitKind }
): boolean {
  if (!holidays.memberPreSale) return false;
  const id = unit.unitId === undefined ? undefined : categoryIdOf(unit.unitId);
  if (id !== undefined && holidays.presaleExcludedCategoryIds.includes(id)) return false;
  return unit.unitKind === undefined || !holidays.presaleExcludes.includes(unit.unitKind);
}

/**
 * Whether a snipe wants a category in the park's member pre-sale: one of the categories it
 * names (`unitIds`) is in it, and one of its stay types (`unitKinds`) is; none named, or no
 * stay type, means any. A snipe's named categories are of its stay types, so a dorm-only snipe
 * naming a category the seed does not know is still a dorm snipe. Margaret River's dorms alone
 * are not in it.
 */
export function wantsPreSale(
  holidays: SchoolHolidayRelease,
  unitIds: readonly string[] = [],
  unitKinds: readonly UnitKind[] = []
): boolean {
  if (!holidays.memberPreSale) return false;
  const byId = unitIds.length === 0 || unitIds.some((unitId) => inPreSale(holidays, { unitId }));
  const byKind =
    unitKinds.length === 0 || unitKinds.some((unitKind) => inPreSale(holidays, { unitKind }));
  return byId && byKind;
}

/** Whether the night `date` is in the park's own seasonal release (month and day, inclusive). */
export function inSeason(season: SeasonalRelease, date: CalendarDate): boolean {
  const monthDay = date.slice(5);
  return season.first <= monthDay && monthDay <= season.last;
}

/** A night's school-holiday release: the public instant, and the member pre-sale's. */
interface HolidayRelease {
  publicAt: Date;
  memberAt: Date;
}

/** The two instants a stay may open at: equal when the member pre-sale does not apply. */
interface StayInstants {
  member: Date;
  public: Date;
}

export interface RacReleasePolicyDeps {
  providerId: ProviderId;
  /**
   * Whether the person has saved an RAC member number. Asked at every compute, never kept.
   * The factory answers false until the member number can be saved.
   */
  isMember: () => Promise<boolean>;
  /** For the warning when `isMember` fails. */
  logger?: Pick<ProviderLogger, 'warn'>;
}

/** What an availability check needs to know about a stay's release, for this person. */
export interface StayRelease {
  /** When the stay opens (`daily_rollover`), unless the policy would refuse it. */
  opensAt?: Date;
  /** Whether the night is held back for a school-holiday release still to come, for the unit. */
  heldBack(night: CalendarDate, unit: { unitId?: string; unitKind?: UnitKind }): boolean;
}

export class RacReleasePolicy implements ReleasePolicy {
  readonly pollFloorMs = Object.freeze({
    window: RAC_WINDOW_POLL_FLOOR_MS,
    continuous: RAC_CONTINUOUS_POLL_FLOOR_MS,
  });

  constructor(private readonly deps: RacReleasePolicyDeps) {}

  supports(mode: ReleaseModeId): boolean {
    return MODES.includes(mode);
  }

  async computeReleaseAt(input: ReleaseComputeInput): Promise<Date | null> {
    const { mode, externalId, stay, requestedAt, unitIds, unitKinds, windowMs, now, signal } =
      input;
    throwIfAborted(signal);
    const park = this.parkOf(externalId);
    switch (mode) {
      case SnipeReleaseMode.SCHEDULED:
        if (!requestedAt) throw this.refuse('A scheduled release needs a time');
        return requestedAt;
      case SnipeReleaseMode.DAILY_ROLLOVER: {
        const member = await this.isMember();
        throwIfAborted(signal);
        const instants = this.instants(park, stay, member, unitIds, unitKinds);
        return this.openingFor(instants, now, windowMs);
      }
      default:
        throw this.refuse(`RAC has no release mode "${mode}"`);
    }
  }

  async describe(externalId: string, signal?: AbortSignal): Promise<string | undefined> {
    throwIfAborted(signal);
    const park = racPark(externalId);
    if (!park) return undefined;
    const rolling = `New dates open daily at midnight AWST, ${RAC_WINDOW_DAYS} days ahead.`;
    const holidays = park.schoolHolidays;
    if (!holidays) {
      const season = park.seasonalRelease;
      if (!season) return rolling;
      const name = season.name.charAt(0).toUpperCase() + season.name.slice(1);
      const days = `${dayMonth(season.first)} to ${dayMonth(season.last)}`;
      return `${rolling} ${name} dates, ${days}, open on set days: choose a time you set.`;
    }
    const members = holidays.memberPreSale ? ', 48 hours earlier for members' : '';
    return `${rolling} School holidays open on RAC's release days at ${holidays.hour} am AWST${members}.`;
  }

  /**
   * For an availability check of `stay` at the park: when it opens (none when the policy would
   * refuse it), and which nights are held back for a school-holiday release still to come for
   * this person, by unit. One `isMember()`.
   */
  async forStay(
    externalId: string,
    stay: StayQuery,
    options: { unitIds?: readonly string[]; now: Date; signal?: AbortSignal }
  ): Promise<StayRelease> {
    const { unitIds, now, signal } = options;
    throwIfAborted(signal);
    const park = this.parkOf(externalId);
    const member = await this.isMember();
    throwIfAborted(signal);
    let opensAt: Date | undefined;
    try {
      opensAt = this.openingFor(this.instants(park, stay, member, unitIds, []), now);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
    }
    const holidays = park.schoolHolidays;
    return {
      ...(opensAt ? { opensAt } : {}),
      heldBack(night, unit) {
        const release = holidays && holidayRelease(night, holidays);
        if (!release) return false;
        const at = member && inPreSale(holidays, unit) ? release.memberAt : release.publicAt;
        return now.getTime() < at.getTime();
      },
    };
  }

  /** Whether the person has a member number; no, with a warning, when that cannot be told. */
  private async isMember(): Promise<boolean> {
    try {
      return (await this.deps.isMember()) === true;
    } catch (error) {
      const kind = error instanceof Error ? error.name : typeof error;
      this.deps.logger?.warn(
        `RAC: could not tell whether a member number is saved (${kind}); public release times`
      );
      return false;
    }
  }

  /** The park, or a refusal for one the seed does not have. */
  private parkOf(externalId: string): RacPark {
    const park = racPark(externalId);
    if (!park) throw this.refuse(`RAC has no park "${externalId}"`);
    return park;
  }

  /**
   * The stay's member and public instants: the rolling window's, or a later school-holiday
   * release. Refuses a night the calendar cannot time at a park in the releases.
   */
  private instants(
    park: RacPark,
    stay: StayQuery,
    member: boolean,
    unitIds: readonly string[] = [],
    unitKinds: readonly UnitKind[] = []
  ): StayInstants {
    const { arrival, departure } = stay;
    if (!isCalendarDate(arrival) || !isCalendarDate(departure) || departure <= arrival) {
      throw this.refuse('A stay needs an arrival and a later departure (YYYY-MM-DD)');
    }
    const nights = eachNight(arrival, departure);
    const season = park.seasonalRelease;
    if (season && nights.some((night) => inSeason(season, night))) {
      throw this.refuse(
        `${park.name} opens its ${season.name} dates on set days. ` +
          'Choose a time you set, or set a watch.'
      );
    }
    const rolling = rollingInstant(departure);
    const holidays = park.schoolHolidays;
    if (!holidays) return { member: rolling, public: rolling };

    const uncovered = nights.find((night) => !isCovered(night));
    if (uncovered) {
      throw this.refuse(
        `WA Stay doesn't know RAC's release dates for ${uncovered.slice(0, 4)} yet. ` +
          'Set a watch, or choose a time you set.'
      );
    }
    if (nights.some((night) => periodOf(night)?.release === 'unannounced')) {
      throw this.refuse(
        `RAC hasn't announced when these school holidays open at ${park.name}. ` +
          'Set a watch, or choose a time you set.'
      );
    }

    let publicAt = rolling;
    let memberAt = rolling;
    for (const night of nights) {
      const release = holidayRelease(night, holidays);
      if (!release) continue;
      if (release.publicAt > publicAt) publicAt = release.publicAt;
      if (release.memberAt > memberAt) memberAt = release.memberAt;
    }
    const preSale = member && wantsPreSale(holidays, unitIds, unitKinds);
    return { member: preSale ? memberAt : publicAt, public: publicAt };
  }

  /**
   * The instant a snipe should start at: the member instant while its window is open, else the
   * public one while its window is open; refused when both have passed. The window is the
   * snipe's own (`windowMs`), never above RAC's 30 minutes.
   */
  private openingFor(instants: StayInstants, now: Date, windowMs = WINDOW_MS): Date {
    const window = Math.min(Math.max(windowMs, 0), WINDOW_MS);
    for (const at of [instants.member, instants.public]) {
      if (now.getTime() < at.getTime() + window) return at;
    }
    throw this.refuse(
      'These dates are already open on RAC. Set a watch to hear about cancellations.'
    );
  }

  private refuse(message: string): ProviderError {
    return new ProviderError({ providerId: this.deps.providerId, message });
  }
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

/** `05-15` → `15 May`. */
function dayMonth(monthDay: string): string {
  const [month, day] = monthDay.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

/** The school-holiday release of the night at a park in the releases, if it is announced. */
function holidayRelease(
  night: CalendarDate,
  holidays: SchoolHolidayRelease
): HolidayRelease | undefined {
  const release = periodOf(night)?.release;
  if (!release || !isAnnounced(release)) return undefined;
  return {
    publicAt: atParkHour(release.publicRelease, holidays),
    memberAt: atParkHour(
      holidays.memberPreSale ? release.memberPreSale : release.publicRelease,
      holidays
    ),
  };
}
