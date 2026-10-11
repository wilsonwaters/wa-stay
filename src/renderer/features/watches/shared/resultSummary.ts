/**
 * The words for what a watch found: its last result on a card ("3 sites available") and the
 * outcome of Check now ("3 sites available at Osprey Bay"). Pure.
 */
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { WatchResult } from '../../../../shared/types/common.types';
import type { Watch, WatchExecutionResult, WatchMatch } from '../../../../shared/types/watch.types';
import { eachNight } from '../../../../shared/utils/calendar-date';
import type { UnitNoun } from '../../../components/stay/UnitPicker';
import { timeInZone } from '../../../components/timeFormat';
import { unitNameOf } from './watchState';

const count = (n: number, noun: UnitNoun) => `${n} ${n === 1 ? noun.one : noun.many}`;

/** Nights of the stay with at least one wanted unit free in the last check. */
function availableNights(watch: Watch): number {
  const free = new Set<string>();
  for (const unit of watch.lastAvailability ?? []) {
    for (const night of unit.nights) if (night.state === 'available') free.add(night.date);
  }
  return eachNight(watch.stay.arrival, watch.stay.departure).filter((d) => free.has(d)).length;
}

/** The nights of the stay that some match covers. */
function matchedNights(matches: readonly WatchMatch[]): Set<string> {
  const nights = new Set<string>();
  for (const match of matches)
    eachNight(match.arrival, match.departure).forEach((n) => nights.add(n));
  return nights;
}

/** A card's result line. */
export function resultSummary(watch: Watch, noun: UnitNoun): string {
  if (!watch.lastResult || !watch.lastCheckedAt) return 'Not checked yet';
  const nights = eachNight(watch.stay.arrival, watch.stay.departure).length;
  switch (watch.lastResult) {
    case WatchResult.FOUND: {
      const full = (watch.lastAvailability ?? []).filter((u) => u.fullyAvailable).length;
      return full > 0 ? `${count(full, noun)} available` : `${noun.many} available`;
    }
    case WatchResult.PARTIAL_FOUND:
      return `${availableNights(watch)} of ${nights} nights available`;
    case WatchResult.NOT_FOUND:
      return 'Nothing yet';
    case WatchResult.HELD:
      return `${unitNameOf(watch, watch.hold?.unitId, noun)} held`;
    case WatchResult.BOOKED:
      return 'Booked';
    default:
      return 'Last check failed';
  }
}

/** What Check now found, for the toast that announces it. */
export function runResultMessage(
  result: WatchExecutionResult,
  watch: Watch,
  noun: UnitNoun,
  manifest: ProviderManifest | undefined
): string {
  const place = watch.location.name;
  if (!result.success) return result.error ?? `The check of ${place} failed. Try again soon.`;
  if (result.expired) return `The stay at ${place} has started, so the watch has stopped.`;
  if (result.hold) {
    const unit = unitNameOf(watch, result.hold.unitId, noun);
    const by = manifest
      ? ` Pay before ${timeInZone(new Date(result.hold.expiresAt), manifest.timezone)}.`
      : '';
    return `${unit} held at ${place}.${by}`;
  }
  const full = result.matches.filter((m) => !m.partial);
  if (full.length > 0) return `${count(full.length, noun)} available at ${place}`;
  const partial = result.matches.filter((m) => m.partial);
  if (partial.length > 0) {
    const nights = eachNight(watch.stay.arrival, watch.stay.departure).length;
    return `${matchedNights(partial).size} of ${nights} nights available at ${place}`;
  }
  return 'Nothing available yet';
}
