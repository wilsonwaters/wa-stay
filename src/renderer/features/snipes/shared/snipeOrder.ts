/**
 * The Site Sniper list's order (pure): the most urgent snipe first, then the soonest release.
 */
import { SnipeStatus } from '../../../../shared/types/common.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';

/**
 * Most urgent first: a hold to pay for, then running snipes, paused, ended (an alert sent and
 * a plan's reminders sent are), booked.
 */
const URGENCY: Partial<Record<string, number>> = {
  [SnipeStatus.HELD]: 0,
  [SnipeStatus.SNIPING]: 1,
  [SnipeStatus.QUEUEING]: 1,
  [SnipeStatus.WAITING_RELEASE]: 1,
  [SnipeStatus.ARMED]: 2,
  [SnipeStatus.DISABLED]: 3,
  [SnipeStatus.FAILED]: 4,
  [SnipeStatus.EXPIRED]: 4,
  [SnipeStatus.ALERTED]: 4,
  [SnipeStatus.REMINDED]: 4,
  [SnipeStatus.BOOKED]: 5,
};

/**
 * The list's order: by urgency, then the soonest release (a hold by its expiry), then the
 * earliest stay, then newest. A new array; the input is left as it is.
 */
export function sortSnipes(snipes: readonly SiteSnipe[]): SiteSnipe[] {
  const due = (snipe: SiteSnipe) => {
    const at = snipe.status === SnipeStatus.HELD ? snipe.holdExpiresAt : snipe.releaseAt;
    return at ? new Date(at).getTime() : Number.POSITIVE_INFINITY;
  };
  return [...snipes].sort(
    (a, b) =>
      (URGENCY[a.status] ?? 3) - (URGENCY[b.status] ?? 3) ||
      due(a) - due(b) ||
      a.stay.arrival.localeCompare(b.stay.arrival) ||
      b.id - a.id
  );
}
