/**
 * What state a watch is in, as the UI shows it: the one place that decides pills, filters and
 * which actions are offered. Pure.
 */
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { WatchResult } from '../../../../shared/types/common.types';
import type { Watch } from '../../../../shared/types/watch.types';
import {
  capitalise,
  kindsOfUnits,
  providerUnitKinds,
  unitNounFrom,
  type UnitNoun,
} from '../../../../shared/utils/unit-noun';
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

/** The StatusPill for a state; a hold names the held unit's noun (`heldNoun`): "Site held". */
export function statusPillFor(state: WatchState, held: UnitNoun): StatusPreset {
  switch (state) {
    case 'held':
    case 'hold-expired':
      return {
        ...statusPresets.watchResult[WatchResult.HELD],
        label: `${capitalise(held.one)} held`,
      };
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

type Kinded = readonly { unitKind?: unknown }[];

/**
 * What a watch's units are called (R9): by the kinds of the units the words are about (`about`:
 * by default its last check's, the units it wants), else its stay types, else the place's units'
 * (`placeUnits`, where the page has them), else its provider's: ParkStay's are sites.
 */
export function watchNoun(
  watch: Pick<Watch, 'lastAvailability' | 'unitKinds'>,
  manifest: ProviderManifest | undefined,
  { about, placeUnits }: { about?: Kinded; placeUnits?: Kinded } = {}
): UnitNoun {
  return unitNounFrom(
    kindsOfUnits(about ?? watch.lastAvailability),
    watch.unitKinds,
    kindsOfUnits(placeUnits),
    providerUnitKinds(manifest)
  );
}

/**
 * What the held unit is called: by its kind in the last check; when it is not there, as
 * `watchNoun` falls back (stay types, the place's, the provider's).
 */
export function heldNoun(
  watch: Pick<Watch, 'lastAvailability' | 'unitKinds' | 'hold'>,
  manifest: ProviderManifest | undefined,
  placeUnits?: Kinded
): UnitNoun {
  const id = watch.hold?.unitId;
  const held = id ? (watch.lastAvailability ?? []).filter((unit) => unit.unitId === id) : [];
  return watchNoun(watch, manifest, { about: held, placeUnits });
}

/**
 * A unit's name from the last check, else "Site 12" for a numeric id (a site's number), else
 * "A site": an id that is not a number (RAC's `cat:4`) is never shown, as a snipe's `unitLabel`.
 */
export function unitNameOf(watch: Watch, unitId: string | undefined, noun: UnitNoun): string {
  const unit = unitId ? watch.lastAvailability?.find((u) => u.unitId === unitId) : undefined;
  if (unit?.unitName) return unit.unitName;
  if (!unitId || !/^\d+$/.test(unitId)) return `A ${noun.one}`;
  return `${capitalise(noun.one)} ${unitId}`;
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
  // A hold that was let go has its message (`lastError`): it ended, not expired
  if (state === 'hold-expired') {
    return `On: the hold on ${unit} ${watch.lastError ? 'ended' : 'expired'}`;
  }
  if (state === 'booked') return `On: ${unit} held, then booked`;
  return watch.autoHold ? `On: hold a ${noun.one} when found` : 'Off';
}
