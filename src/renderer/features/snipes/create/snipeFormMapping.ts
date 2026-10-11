/**
 * Between the snipe form and the snipes contract (V4): the timing conversions (seconds and
 * minutes in the form, ms in the contract), what create sends, the name a new snipe gets, and
 * which field a `VALIDATION` issue from main names. Calendar dates stay `YYYY-MM-DD` strings;
 * no user id (main resolves the local profile). Pure.
 */
import { SnipeReleaseMode } from '../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipeInput } from '../../../../shared/types/site-sniper.types';
import type { LocationChoice } from '../../../components/LocationCombobox';
import { toStayParams } from '../../../components/stay/stayFields';
import { stayDatesLabel } from '../../../components/stay/stayFormat';
import {
  parseNumber,
  snipeStayFields,
  type SnipeFieldName,
  type SnipeFormValues,
} from './snipeForm';
import { zonedInstant } from './zonedTime';

/** Seconds as the contract's whole milliseconds: 1.5 → 1500. */
export const secondsToMs = (seconds: number) => Math.round(seconds * 1000);
/** Minutes as whole milliseconds: 15 → 900000. */
export const minutesToMs = (minutes: number) => Math.round(minutes * 60_000);
/** Milliseconds as seconds for the form: 1500 → 1.5. */
export const msToSeconds = (ms: number) => Number((ms / 1000).toFixed(3));
/** Milliseconds as minutes for the form: 900000 → 15. */
export const msToMinutes = (ms: number) => Number((ms / 60_000).toFixed(3));

/** "Osprey Bay · Fri 11 – Sun 13 Dec": what a new snipe is called until the person names it. */
export function suggestedName(
  location: Pick<LocationChoice, 'name'> | null,
  arrival: string,
  departure: string,
  today: string
): string {
  if (!location) return '';
  return arrival && departure
    ? `${location.name} · ${stayDatesLabel(arrival, departure, today)}`
    : location.name;
}

/** Whether the chosen release mode waits in the provider's queue (and the provider has one). */
export function modeUsesQueue(manifest: ProviderManifest | undefined, modeId: string): boolean {
  if (manifest?.capabilities.accessGate !== true) return false;
  return manifest.releaseModes?.find((mode) => mode.id === modeId)?.usesAccessGate === true;
}

/** What `snipes.create` gets. `values` must have passed the schema. */
export function toSnipeInput(
  values: SnipeFormValues,
  manifest: ProviderManifest | undefined
): SiteSnipeInput {
  if (!values.location) throw new Error('A snipe needs a location');
  const stayParams = toStayParams(snipeStayFields(manifest), values.stayParams);
  const releaseAt =
    values.releaseMode === SnipeReleaseMode.SCHEDULED && manifest
      ? zonedInstant(values.releaseDate, values.releaseTime, manifest.timezone)
      : undefined;
  const continuous = values.releaseMode === SnipeReleaseMode.CANCELLATION;
  const notes = values.notes.trim();
  const { location } = values;
  return {
    providerId: values.providerId,
    name: values.name.trim(),
    location: {
      externalId: location.externalId,
      name: location.name,
      ...(location.areaName ? { areaName: location.areaName } : {}),
    },
    stay: {
      arrival: values.arrival,
      departure: values.departure,
      adults: values.adults,
      ...(values.children > 0 ? { children: values.children } : {}),
      ...(values.infants > 0 ? { infants: values.infants } : {}),
    },
    ...(values.unitIds.length ? { unitIds: values.unitIds } : {}),
    ...(Object.keys(stayParams).length ? { stayParams } : {}),
    releaseMode: values.releaseMode as SnipeReleaseMode,
    ...(releaseAt ? { releaseAt } : {}),
    ...(manifest?.capabilities.accessGate
      ? {
          accessGateEnabled:
            values.accessGateEnabled && modeUsesQueue(manifest, values.releaseMode),
        }
      : {}),
    ...(continuous ? {} : { leadTimeSeconds: parseNumber(values.leadTimeSeconds) ?? 0 }),
    pollIntervalMs: secondsToMs(parseNumber(values.pollIntervalSeconds) ?? 0),
    ...(continuous
      ? {}
      : { windowDurationMs: minutesToMs(parseNumber(values.windowMinutes) ?? 0) }),
    maxAttempts: parseNumber(values.maxAttempts) ?? 0,
    ...(notes ? { notes } : {}),
  };
}

const TOP_LEVEL: Partial<Record<string, SnipeFieldName>> = {
  providerId: 'providerId',
  name: 'name',
  releaseMode: 'releaseMode',
  accessGateEnabled: 'accessGateEnabled',
  leadTimeSeconds: 'leadTimeSeconds',
  pollIntervalMs: 'pollIntervalSeconds',
  windowDurationMs: 'windowMinutes',
  maxAttempts: 'maxAttempts',
  notes: 'notes',
};

/**
 * The form field a `VALIDATION` issue path from main names. `releaseAt` is the release date
 * for a scheduled release, and otherwise the release mode: the provider could not work out
 * the release, and the date field is hidden then.
 */
export function issueField(path: string, releaseMode?: string): SnipeFieldName | undefined {
  if (path === 'releaseAt') {
    return releaseMode === SnipeReleaseMode.SCHEDULED ? 'releaseDate' : 'releaseMode';
  }
  if (path.startsWith('location')) return 'location';
  if (path === 'stay' || path.startsWith('stay.')) {
    const key = path.slice('stay.'.length);
    return key === 'departure' || key === 'adults' ? key : 'arrival';
  }
  if (/^stayParams\.[A-Za-z][A-Za-z0-9]*$/.test(path)) return path as SnipeFieldName;
  return TOP_LEVEL[path];
}
