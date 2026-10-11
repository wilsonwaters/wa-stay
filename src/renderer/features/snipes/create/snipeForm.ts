/**
 * The new-snipe form: its values, the rules each step checks (zod, with the provider's own stay
 * field rules), and a blank form for a provider. Advanced timing is typed as text (seconds and
 * minutes, as people think of them) and becomes the contract's ms fields on submit.
 */
import { z } from 'zod';
import {
  DEFAULT_SNIPE_LEAD_TIME_SECONDS,
  DEFAULT_SNIPE_POLL_INTERVAL_MS,
  DEFAULT_SNIPE_WINDOW_MS,
  MAX_SNIPE_POLL_INTERVAL_MS,
  MIN_SNIPE_POLL_INTERVAL_MS,
} from '../../../../shared/constants/app-constants';
import { SnipeReleaseMode } from '../../../../shared/types/common.types';
import {
  LOCATION_KINDS,
  type ProviderManifest,
  type StayFieldDescriptor,
} from '../../../../shared/types/provider.types';
import {
  stayFieldDefaults,
  stayFieldIssue,
  stayFieldsFor,
} from '../../../components/stay/stayFields';
import { zonedInstant } from './zonedTime';

const shape = z.object({
  providerId: z.string(),
  location: z
    .object({
      externalId: z.string(),
      name: z.string(),
      areaName: z.string().optional(),
      kind: z.enum(LOCATION_KINDS).optional(),
      unitCount: z.number().optional(),
    })
    .nullable(),
  /** Calendar dates `YYYY-MM-DD`, or '' until chosen. */
  arrival: z.string(),
  departure: z.string(),
  adults: z.number(),
  children: z.number(),
  infants: z.number(),
  stayParams: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]).optional()),
  unitIds: z.array(z.string()),
  /** A `releaseModes` id of the provider. */
  releaseMode: z.string(),
  /** A scheduled release, in the provider's zone: `YYYY-MM-DD` and `HH:MM`. */
  releaseDate: z.string(),
  releaseTime: z.string(),
  accessGateEnabled: z.boolean(),
  leadTimeSeconds: z.string(),
  pollIntervalSeconds: z.string(),
  windowMinutes: z.string(),
  maxAttempts: z.string(),
  name: z.string(),
  notes: z.string(),
});

export type SnipeFormValues = z.infer<typeof shape>;
export type SnipeFieldName = Exclude<keyof SnipeFormValues, 'stayParams'> | `stayParams.${string}`;
export type SnipeStepId = 'provider' | 'location' | 'stay' | 'release' | 'review';

/** The provider's stay fields a snipe asks for: its own, and what a hold needs. */
export function snipeStayFields(manifest: ProviderManifest | undefined): StayFieldDescriptor[] {
  return stayFieldsFor(manifest, ['snipe', 'hold']);
}

/** The ms or s value as text without trailing zeros: 1500 ms → "1.5". */
const trim = (value: number) => String(Number(value.toFixed(3)));

/** A blank form for a provider (its stay field defaults and first release mode). */
export function emptySnipeForm(manifest: ProviderManifest | undefined): SnipeFormValues {
  return {
    providerId: manifest?.id ?? '',
    location: null,
    arrival: '',
    departure: '',
    adults: 2,
    children: 0,
    infants: 0,
    stayParams: stayFieldDefaults(snipeStayFields(manifest)),
    unitIds: [],
    releaseMode: manifest?.releaseModes?.[0]?.id ?? '',
    releaseDate: '',
    releaseTime: '',
    accessGateEnabled: manifest?.capabilities.accessGate === true,
    leadTimeSeconds: String(DEFAULT_SNIPE_LEAD_TIME_SECONDS),
    pollIntervalSeconds: trim(DEFAULT_SNIPE_POLL_INTERVAL_MS / 1000),
    windowMinutes: trim(DEFAULT_SNIPE_WINDOW_MS / 60_000),
    maxAttempts: '0',
    name: '',
    notes: '',
  };
}

/** A typed number, or undefined when it is not one. */
export function parseNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;
  return Number(trimmed);
}

export const MIN_POLL_SECONDS = MIN_SNIPE_POLL_INTERVAL_MS / 1000;
export const MAX_POLL_SECONDS = MAX_SNIPE_POLL_INTERVAL_MS / 1000;

export interface SnipeFormContext {
  manifest: ProviderManifest | undefined;
  /** Today in the provider's time zone, `YYYY-MM-DD`. */
  today: string;
  now: Date;
}

/** Midnight of check-in day where the provider is (epoch ms), or never when there is no date. */
function checkInAt(arrival: string, timeZone: string): number {
  return zonedInstant(arrival, '00:00', timeZone)?.getTime() ?? Number.POSITIVE_INFINITY;
}

/** The form's rules for one provider. */
export function snipeFormSchema({ manifest, today, now }: SnipeFormContext) {
  const fields = snipeStayFields(manifest);
  const modes = manifest?.releaseModes ?? [];
  return shape.superRefine((v, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });

    if (!v.providerId) issue(['providerId'], 'Choose a provider');
    if (!v.location) issue(['location'], 'Choose a location');
    if (!v.arrival || !v.departure) issue(['arrival'], 'Choose your check-in and check-out dates');
    else if (v.arrival < today) issue(['arrival'], "Check-in can't be in the past");
    else if (v.departure <= v.arrival)
      issue(['departure'], 'Choose a check-out date after check-in');
    if (v.adults < 1) issue(['adults'], 'Add at least 1 adult');
    for (const field of fields) {
      const message = stayFieldIssue(field, v.stayParams[field.key]);
      if (message) issue(['stayParams', field.key], message);
    }

    if (!modes.some((mode) => mode.id === v.releaseMode)) {
      issue(['releaseMode'], 'Choose when the sites are released');
    } else if (v.releaseMode === SnipeReleaseMode.SCHEDULED && manifest) {
      const at = zonedInstant(v.releaseDate, v.releaseTime, manifest.timezone);
      if (!v.releaseDate || !v.releaseTime)
        issue(['releaseDate'], 'Enter the release date and time');
      else if (!at) issue(['releaseDate'], 'Enter a real date and time');
      else if (at.getTime() <= now.getTime())
        issue(['releaseDate'], 'Choose a release time in the future');
      else if (checkInAt(v.arrival, manifest.timezone) <= at.getTime())
        issue(['releaseDate'], 'Choose a release time before check-in');
    }
    const whole = (text: string) => {
      const n = parseNumber(text);
      return n !== undefined && Number.isInteger(n) ? n : undefined;
    };
    // A cancellation snipe has no release: no lead time, and it keeps checking (no window).
    const continuous = v.releaseMode === SnipeReleaseMode.CANCELLATION;
    const lead = whole(v.leadTimeSeconds);
    if (!continuous && (lead === undefined || lead > 3600)) {
      issue(['leadTimeSeconds'], 'Enter whole seconds, from 0 to 3600');
    }
    const poll = parseNumber(v.pollIntervalSeconds);
    if (poll === undefined || poll < MIN_POLL_SECONDS || poll > MAX_POLL_SECONDS) {
      issue(
        ['pollIntervalSeconds'],
        `Enter seconds from ${MIN_POLL_SECONDS} to ${MAX_POLL_SECONDS}`
      );
    }
    const window = whole(v.windowMinutes);
    if (!continuous && (window === undefined || window < 1 || window > 1440)) {
      issue(['windowMinutes'], 'Enter whole minutes, from 1 to 1440');
    }
    if (whole(v.maxAttempts) === undefined)
      issue(['maxAttempts'], 'Enter a whole number; 0 means no limit');

    if (!v.name.trim()) issue(['name'], 'Give the snipe a name');
    else if (v.name.trim().length > 200) issue(['name'], 'Keep the name to 200 characters');
    if (v.notes.length > 1000) issue(['notes'], 'Keep notes to 1,000 characters');
  });
}

/** The fields each step checks before moving on. */
export function stepFields(
  step: SnipeStepId,
  manifest: ProviderManifest | undefined
): SnipeFieldName[] {
  switch (step) {
    case 'provider':
      return ['providerId'];
    case 'location':
      return ['location'];
    case 'stay':
      return [
        'arrival',
        'departure',
        'adults',
        ...snipeStayFields(manifest).map((field) => `stayParams.${field.key}` as const),
      ];
    case 'release':
      return [
        'releaseMode',
        'releaseDate',
        'leadTimeSeconds',
        'pollIntervalSeconds',
        'windowMinutes',
        'maxAttempts',
      ];
    default:
      return ['name', 'notes'];
  }
}
