/**
 * The words for what a watch found: its last result on a card ("3 sites available") and the
 * outcome of Check now ("3 sites available at Osprey Bay"). What is free for the whole stay is
 * counted as Explore and the alert count it (`sumFreeUnits`: RAC's sites of each category free
 * for the whole stay, else one per unit), in Explore's word when the provider counts its units,
 * so an RAC park reads "51 sites free" (`freeUnitsWord`). A stay free every night only by
 * moving between units reads "Free across 2 sites", or "Free if you move sites" when the
 * provider can't say how many (`splitStayResultLine`): never "available". Pure.
 */
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { WatchResult } from '../../../../shared/types/common.types';
import type { Watch, WatchExecutionResult, WatchMatch } from '../../../../shared/types/watch.types';
import { eachNight } from '../../../../shared/utils/calendar-date';
import { freeUnitsWord, sumFreeUnits } from '../../../../shared/utils/free-units';
import {
  nounOfUnits,
  unitCountLabel as count,
  type UnitNoun,
} from '../../../../shared/utils/unit-noun';
import { isFullyAvailable } from '../../../components/nightGridModel';
import { splitStayResultLine } from '../../../components/SplitStays';
import { timeInZone } from '../../../components/timeFormat';
import { unitNameOf } from './watchState';

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

/**
 * A card's result line. `noun` is the watch's (`watchNoun`); the units found are named by their
 * own kinds when they say them.
 */
export function resultSummary(watch: Watch, noun: UnitNoun): string {
  if (!watch.lastResult || !watch.lastCheckedAt) return 'Not checked yet';
  const nights = eachNight(watch.stay.arrival, watch.stay.departure).length;
  switch (watch.lastResult) {
    case WatchResult.FOUND: {
      // Free every night as the night grid reads it (a night refused by stay rules is not)
      const stay = eachNight(watch.stay.arrival, watch.stay.departure);
      const full = (watch.lastAvailability ?? []).filter((u) => isFullyAvailable(u, stay));
      return full.length > 0
        ? `${count(sumFreeUnits(full), nounOfUnits(full, noun))} ${freeUnitsWord(full)}`
        : `${noun.many} available`;
    }
    case WatchResult.SPLIT_FOUND:
      return splitStayResultLine(watch.splitStays, noun);
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
    // This check's own units name it (the watch is from before the check, with no units yet)
    const held = result.hold.unitId;
    const unit =
      result.matches.find((match) => match.unitId === held)?.unitName ??
      unitNameOf(watch, held, noun);
    // A guessed expiry is "about" (R18)
    const about = result.hold.expiresEstimated ? 'about ' : '';
    const by = manifest
      ? ` Pay before ${about}${timeInZone(new Date(result.hold.expiresAt), manifest.timezone)}.`
      : '';
    return `${unit} held at ${place}.${by}`;
  }
  const full = result.matches.filter((m) => !m.partial);
  if (full.length > 0)
    return `${count(sumFreeUnits(full), nounOfUnits(full, noun))} ${freeUnitsWord(full)} at ${place}`;
  // Free every night only by moving between units: below a whole stay, above some nights
  if (result.splitStays && result.splitStays.length > 0) {
    return `${splitStayResultLine(result.splitStays, noun)} at ${place}`;
  }
  const partial = result.matches.filter((m) => m.partial);
  if (partial.length > 0) {
    const nights = eachNight(watch.stay.arrival, watch.stay.departure).length;
    return `${matchedNights(partial).size} of ${nights} nights available at ${place}`;
  }
  return 'Nothing available yet';
}
