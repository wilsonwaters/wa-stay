/**
 * What an alerted snipe found (`SiteSnipe.alert`, §12.35), in words: the unit that was free, the
 * booking page to open, and what is announced when a snipe on screen alerts. Pure.
 */
import type { UnitSummary } from '../../../../shared/types/catalog.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { heldUnitNoun } from './snipeNouns';
import { unitLabel } from './snipeState';

/**
 * The unit an alerted snipe found free: as its alert names it ("CAMPSITE 03"), else by the
 * place's name for it or its id ("Site 3", "A site"). Undefined when the snipe has no alert (it
 * could not be read): the dates were free, but which unit is not known.
 */
export function alertedUnitLabel(
  snipe: Pick<SiteSnipe, 'alert' | 'unitIds' | 'unitKinds' | 'holdUnitId'>,
  manifest: ProviderManifest | undefined,
  place?: { units?: readonly UnitSummary[]; names?: ReadonlyMap<string, string> }
): string | undefined {
  const { alert } = snipe;
  if (!alert) return undefined;
  if (alert.unitName) return alert.unitName;
  const noun = heldUnitNoun(snipe, manifest, place?.units, alert.unitId);
  return unitLabel(alert.unitId, noun, place?.names);
}

/**
 * The alert's booking page, when it is one to open in the browser: https only (main stores no
 * other, §12.35).
 */
export function alertBookingUrl(snipe: Pick<SiteSnipe, 'alert'>): string | undefined {
  const url = snipe.alert?.bookingUrl;
  return url?.startsWith('https://') ? url : undefined;
}

/**
 * "Osprey Bay weekend: CAMPSITE 03 is free. Book on ParkStay.": what an alerted snipe found, as
 * its alert names the unit ("A site is free" when the alert does not say which).
 */
export function alertedMessage(snipe: SiteSnipe, manifest: ProviderManifest | undefined): string {
  const unit = alertedUnitLabel(snipe, manifest) ?? `A ${heldUnitNoun(snipe, manifest).one}`;
  return `${snipe.name}: ${unit} is free. Book on ${manifest?.shortName ?? 'the booking site'}.`;
}
