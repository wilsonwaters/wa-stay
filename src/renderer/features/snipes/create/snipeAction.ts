/**
 * What a snipe does when the dates are free (`SiteSnipe.action`, §12.35) and how long it keeps
 * trying, as the new-snipe flow and the snipe's page decide them from the provider's manifest:
 * a hold where the provider places holds (its default there, RS9), else an alert; and a release
 * mode's limit on the window (`maxWindowMinutes`). Pure.
 */
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SnipeAction } from '../../../../shared/types/site-sniper.types';
import type { UnitNoun } from '../../../../shared/utils/unit-noun';

/** What a new snipe does by default: hold where the provider places holds, else alert. */
export function defaultSnipeAction(manifest: ProviderManifest | undefined): SnipeAction {
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
  return manifest?.releaseModes?.find((mode) => mode.id === releaseMode)?.maxWindowMinutes;
}

/**
 * Why a snipe that holds, at a mixed place, needs one stay type or a unit chosen: none, or more
 * than one, is chosen. Shown on the Release step, where "Hold it for me" is chosen.
 */
export function snipeHoldChoiceMessage(noun: UnitNoun): string {
  return `Choose one stay type or a ${noun.one}. At a place with more than one stay type, Site Sniper holds only what you choose.`;
}
