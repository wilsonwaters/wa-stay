/**
 * What state a watch is in, as the UI shows it: the one place that decides pills, filters and
 * which actions are offered. Pure.
 */
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { WatchResult } from '../../../../shared/types/common.types';
import type { Watch } from '../../../../shared/types/watch.types';
import { unitNoun } from '../../../components/locationFormat';
import type { UnitNoun } from '../../../components/stay/UnitPicker';
import { statusPresets, type StatusPreset } from '../../../components/ui';

export type WatchState = 'active' | 'paused' | 'ended' | 'held' | 'hold-expired' | 'booked';

/**
 * - booked: its hold was paid for;
 * - held / hold-expired: its automatic hold, until and after `hold.expiresAt`;
 * - ended: the stay has started or passed (main stops it on its next run);
 * - otherwise active or paused.
 */
export function watchStateOf(watch: Watch, today: string, now: Date): WatchState {
  if (watch.lastResult === WatchResult.BOOKED) return 'booked';
  const ended = today >= watch.stay.arrival;
  if (watch.lastResult === WatchResult.HELD) {
    const live = watch.hold && new Date(watch.hold.expiresAt).getTime() > now.getTime();
    if (live) return 'held';
    return ended ? 'ended' : 'hold-expired';
  }
  if (ended) return 'ended';
  return watch.isActive ? 'active' : 'paused';
}

/** The StatusPill for a state. */
export function statusPillFor(state: WatchState): StatusPreset {
  switch (state) {
    case 'held':
    case 'hold-expired':
      return statusPresets.watchResult[WatchResult.HELD];
    case 'booked':
      return statusPresets.watchResult[WatchResult.BOOKED];
    case 'ended':
      return statusPresets.watch.ended;
    case 'paused':
      return statusPresets.watch.paused;
    default:
      return statusPresets.watch.active;
  }
}

/**
 * What a provider's units are called (its main location kind): ParkStay's are sites. A watch
 * keeps no location kind, so this is the provider's first.
 */
export function unitNounFor(manifest: ProviderManifest | undefined): UnitNoun {
  return unitNoun(manifest?.locationKinds[0]);
}

/** A unit's name from the last check, else "site 12". */
export function unitNameOf(watch: Watch, unitId: string | undefined, noun: UnitNoun): string {
  if (!unitId) return `A ${noun.one}`;
  const unit = watch.lastAvailability?.find((u) => u.unitId === unitId);
  return unit?.unitName ?? `${noun.one.charAt(0).toUpperCase()}${noun.one.slice(1)} ${unitId}`;
}

/** The hold panel's region name, unique per hold: "Hold at Osprey Bay". */
export function holdRegionLabel(watch: Watch): string {
  return `Hold at ${watch.location.name || watch.name}`;
}

/**
 * The Automatic hold line for a watch. Once its auto-hold has placed a hold (held, expired or
 * paid for), that is what it says, whatever else is stored; otherwise the stored setting.
 */
export function autoHoldLabel(
  watch: Watch,
  state: WatchState,
  noun: UnitNoun,
  holdUntil?: string
): string {
  const unit = unitNameOf(watch, watch.hold?.unitId, noun);
  if (state === 'held')
    return holdUntil ? `On: ${unit} held until ${holdUntil}` : `On: ${unit} held`;
  if (state === 'hold-expired') return `On: the hold on ${unit} expired`;
  if (state === 'booked') return `On: ${unit} held, then booked`;
  return watch.autoHold ? `On: hold a ${noun.one} when found` : 'Off';
}
