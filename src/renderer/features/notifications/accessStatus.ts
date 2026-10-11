/**
 * How a provider's access gate (its queue or waiting room) reads in the tray, and when a change
 * is worth announcing. Pure: the chip and its tests share it.
 */
import type { AccessState, AccessStatus } from '../../../shared/types/provider.types';

/** A queue position change is announced at most this often. */
export const POSITION_ANNOUNCE_INTERVAL_MS = 60_000;

/** Idle (nothing holds the gate) and unsupported (no gate) show no chip. */
export function isAccessChipShown(status: AccessStatus | undefined): status is AccessStatus {
  return status !== undefined && status.state !== 'idle' && status.state !== 'unsupported';
}

/** "about 4 min", "about 2 h"; null for a missing or zero estimate. */
export function waitText(seconds: number | undefined): string | null {
  if (seconds === undefined || !(seconds > 0)) return null;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 90 ? `about ${minutes} min` : `about ${Math.round(minutes / 60)} h`;
}

/**
 * The chip's line:
 * - waiting: "ParkStay queue · position 123 · about 4 min" (a zero position or a missing
 *   estimate is left out);
 * - active: "ParkStay · access granted" (the chip adds "· 12 min left" as a countdown);
 * - expired: "ParkStay queue session expired";
 * - error, or a state this version does not know: "ParkStay queue status unavailable".
 */
export function accessStatusText(status: AccessStatus, shortName: string): string {
  switch (status.state) {
    case 'waiting': {
      const parts = [`${shortName} queue`];
      if (status.position !== undefined && status.position > 0) {
        parts.push(`position ${status.position}`);
      }
      const wait = waitText(status.etaSeconds);
      if (wait) parts.push(wait);
      return parts.join(' · ');
    }
    case 'active':
      return `${shortName} · access granted`;
    case 'expired':
      return `${shortName} queue session expired`;
    default:
      return `${shortName} queue status unavailable`;
  }
}

/** What was last seen of a gate, and when the chip last announced anything. */
export interface AnnouncedAccess {
  state: AccessState;
  position?: number;
  /** `Date.now()` of the last announcement, if any. */
  announcedAt: number | null;
}

/**
 * The polite announcement for a change, or null. A change of state is always announced
 * (waiting → access granted, → expired, → unavailable); a new position while waiting at most
 * once a minute; a gate going idle is not (its chip goes away).
 */
export function accessAnnouncement(
  previous: AnnouncedAccess | null,
  next: AccessStatus,
  shortName: string,
  now: number
): string | null {
  if (!isAccessChipShown(next)) return null;
  const text = accessStatusText(next, shortName);
  if (!previous || previous.state !== next.state) return text;
  if (next.state !== 'waiting' || next.position === previous.position) return null;
  const quiet =
    previous.announcedAt === null || now - previous.announcedAt >= POSITION_ANNOUNCE_INTERVAL_MS;
  return quiet ? text : null;
}
