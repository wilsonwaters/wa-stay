/**
 * What a snipe does when the dates are free (`SiteSnipe.action`, §12.35) and how long it keeps
 * trying, as the new-snipe flow and the snipe's page decide them from the provider's manifest:
 * a hold where the provider places holds (its default there, RS9), else an alert, and in a mode
 * that only reminds (`remindOnly`, §12.39) an Open Day plan; and a release mode's limit on the
 * window (`maxWindowMinutes`). Pure.
 */
import type { ProviderExperimentState } from '../../../../shared/contracts/providers';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SnipeAction } from '../../../../shared/types/site-sniper.types';
import type { UnitNoun } from '../../../../shared/utils/unit-noun';

/**
 * Whether the provider's holds are turning off: an experiment that turns them on is on in this
 * run but no longer chosen, so main treats the provider as without holds until WA Stay restarts
 * (`holdsOf`, R17): new snipes alert, and a hold is refused.
 */
export function holdsTurningOff(
  manifest: ProviderManifest | undefined,
  states: readonly ProviderExperimentState[] | undefined
): boolean {
  const holds = (manifest?.experiments ?? []).filter((e) => e.turnsOn.includes('holds'));
  const state = (id: string) => states?.find((s) => s.id === id);
  if (!holds.some((e) => state(e.id)?.active)) return false;
  return !holds.some((e) => state(e.id)?.enabled);
}

/** The release mode `modeId` of the provider, when it declares it. */
export function releaseModeOf(manifest: ProviderManifest | undefined, modeId: string) {
  return manifest?.releaseModes?.find((mode) => mode.id === modeId);
}

/** Whether the mode only reminds (an Open Day plan, §12.39): it never checks, alerts or holds. */
export function remindsOnly(manifest: ProviderManifest | undefined, modeId: string): boolean {
  return releaseModeOf(manifest, modeId)?.remindOnly === true;
}

/**
 * What a new snipe does by default in `modeId` (the provider's first mode unless given): a plan
 * in a mode that only reminds, else hold where the provider places holds, else alert.
 */
export function defaultSnipeAction(
  manifest: ProviderManifest | undefined,
  modeId = manifest?.releaseModes?.[0]?.id ?? ''
): SnipeAction {
  if (remindsOnly(manifest, modeId)) return 'remind';
  return manifest?.capabilities.holds === true ? 'hold' : 'alert';
}

/**
 * How long a snipe may keep trying after the release in the provider's mode
 * (`maxWindowMinutes`), when the mode sets a limit.
 */
export function windowCapMinutes(
  manifest: ProviderManifest | undefined,
  releaseMode: string
): number | undefined {
  return releaseModeOf(manifest, releaseMode)?.maxWindowMinutes;
}

/**
 * Why a snipe that holds, at a mixed place, needs one stay type or a unit chosen (none, or more
 * than one, is chosen), and where to fix it: shown on the Release step, where "Hold it for me"
 * is chosen, while the stay types and units are under "Your stay".
 */
export function snipeHoldChoiceMessage(noun: UnitNoun, place = 'This place'): string {
  return `${place} has more than one stay type. To hold one, choose a stay type or a ${noun.one} under "Your stay", or choose Alert me.`;
}
