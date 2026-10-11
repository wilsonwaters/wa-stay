/**
 * The watch form: its values, the rules each step checks (zod, with the provider's own stay
 * field rules), and the check intervals the provider allows. The form is typed
 * from this schema.
 */
import { z } from 'zod';
import {
  DEFAULT_WATCH_INTERVAL,
  WATCH_INTERVAL_OPTIONS,
} from '../../../../shared/contracts/watches';
import { MIN_WATCH_INTERVAL_MINUTES } from '../../../../shared/constants/app-constants';
import {
  LOCATION_KINDS,
  providerLimits,
  type ProviderManifest,
  type StayFieldDescriptor,
} from '../../../../shared/types/provider.types';
import { stayFieldIssue, stayFieldsFor } from '../../../components/stay/stayFields';

const locationSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  areaName: z.string().optional(),
  kind: z.enum(LOCATION_KINDS).optional(),
  unitCount: z.number().optional(),
});

const shape = z.object({
  providerId: z.string(),
  location: locationSchema.nullable(),
  /** Calendar dates `YYYY-MM-DD`, or '' until chosen. */
  arrival: z.string(),
  departure: z.string(),
  adults: z.number(),
  children: z.number(),
  infants: z.number(),
  stayParams: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]).optional()),
  unitIds: z.array(z.string()),
  /** As typed: '' is no limit. Never `valueAsNumber`, which turns '' into NaN. */
  maxPrice: z.string(),
  checkIntervalMinutes: z.number(),
  allowPartialMatch: z.boolean(),
  notifyOnly: z.boolean(),
  autoHold: z.boolean(),
  name: z.string(),
  notes: z.string(),
});

export type WatchFormValues = z.infer<typeof shape>;
export type WatchFieldName = Exclude<keyof WatchFormValues, 'stayParams'> | `stayParams.${string}`;

/** "40", "40.5", "40.50". */
const PRICE = /^\d+(\.\d{1,2})?$/;
export const PRICE_MESSAGE = 'Enter a price in dollars, like 40, or leave it empty';

/** A typed max price as dollars; undefined for '' (no limit) or anything that is not one. */
export function parsePrice(text: string): number | undefined {
  const trimmed = text.trim().replace(/^\$/, '');
  if (!PRICE.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value > 0 ? value : undefined;
}

/** The provider's stay fields for a watch, and those an automatic hold adds. */
export function watchStayFields(manifest: ProviderManifest | undefined): {
  watch: StayFieldDescriptor[];
  hold: StayFieldDescriptor[];
} {
  const watch = stayFieldsFor(manifest, ['watch']);
  const hold = manifest?.capabilities.holds ? stayFieldsFor(manifest, ['hold'], watch) : [];
  return { watch, hold };
}

/**
 * The check intervals this provider allows, from the contract's list. An existing watch's own
 * interval (`keep`) stays on offer even when the list no longer has it (v1 watches carry 5
 * minutes), so editing anything else never changes or blocks it.
 */
export function intervalOptions(manifest: ProviderManifest | undefined, keep?: number): number[] {
  const min = manifest ? providerLimits(manifest).minWatchIntervalMinutes : 0;
  const options: number[] = WATCH_INTERVAL_OPTIONS.filter((minutes) => minutes >= min);
  return keep !== undefined && !options.includes(keep)
    ? [...options, keep].sort((a, b) => a - b)
    : options;
}

/** How often a watch really runs: never below 15 minutes, nor below the provider's limit. */
export function effectiveInterval(minutes: number, manifest: ProviderManifest | undefined): number {
  const providerMin = manifest ? providerLimits(manifest).minWatchIntervalMinutes : 0;
  return Math.max(minutes, MIN_WATCH_INTERVAL_MINUTES, providerMin);
}

export function defaultInterval(manifest: ProviderManifest | undefined): number {
  const options = intervalOptions(manifest);
  return options.includes(DEFAULT_WATCH_INTERVAL) ? DEFAULT_WATCH_INTERVAL : options[0];
}

function every(minutes: number): string {
  if (minutes === 1440) return 'Once a day';
  if (minutes === 60) return 'Every hour';
  if (minutes % 60 === 0) return `Every ${minutes / 60} hours`;
  return `Every ${minutes} minutes`;
}

/**
 * "Every 15 minutes", "Every hour", "Every 4 hours", "Once a day". An interval shorter than the
 * checks really run says so: "Every 5 minutes (checks run every 15)".
 */
export function intervalLabel(minutes: number, manifest?: ProviderManifest): string {
  const runs = effectiveInterval(minutes, manifest);
  return runs > minutes ? `${every(minutes)} (checks run every ${runs})` : every(minutes);
}

export interface WatchFormContext {
  manifest: ProviderManifest | undefined;
  /** Today in the provider's time zone, `YYYY-MM-DD`. */
  today: string;
  /** Edit: the stored arrival, which may already have passed, is accepted unchanged. */
  keepArrival?: string;
  /** Edit: the stored check interval, which the list may no longer offer, is accepted unchanged. */
  keepInterval?: number;
}

/** The form's rules for one provider. */
export function watchFormSchema({ manifest, today, keepArrival, keepInterval }: WatchFormContext) {
  const fields = watchStayFields(manifest);
  const intervals = intervalOptions(manifest, keepInterval);
  return shape.superRefine((v, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });

    if (!v.providerId) issue(['providerId'], 'Choose a provider');
    if (!v.location) issue(['location'], 'Choose a location');
    if (!v.arrival || !v.departure) {
      issue(['arrival'], 'Choose your check-in and check-out dates');
    } else if (v.arrival < today && v.arrival !== keepArrival) {
      issue(['arrival'], "Check-in can't be in the past");
    } else if (v.departure <= v.arrival) {
      issue(['departure'], 'Choose a check-out date after check-in');
    }
    if (v.adults < 1) issue(['adults'], 'Add at least 1 adult');
    for (const field of v.autoHold ? [...fields.watch, ...fields.hold] : fields.watch) {
      const message = stayFieldIssue(field, v.stayParams[field.key]);
      if (message) issue(['stayParams', field.key], message);
    }
    if (v.maxPrice.trim() && parsePrice(v.maxPrice) === undefined)
      issue(['maxPrice'], PRICE_MESSAGE);
    if (!intervals.includes(v.checkIntervalMinutes)) {
      issue(['checkIntervalMinutes'], 'Choose how often to check');
    }
    if (!v.name.trim()) issue(['name'], 'Give the watch a name');
    else if (v.name.trim().length > 200) issue(['name'], 'Keep the name to 200 characters');
    if (v.notes.length > 1000) issue(['notes'], 'Keep notes to 1,000 characters');
  });
}

/** The fields each step checks before moving on. */
export function stepFields(
  step: 'provider' | 'location' | 'stay' | 'alerts' | 'review',
  manifest: ProviderManifest | undefined,
  autoHold: boolean
): WatchFieldName[] {
  const fields = watchStayFields(manifest);
  const params = (list: StayFieldDescriptor[]): WatchFieldName[] =>
    list.map((field) => `stayParams.${field.key}` as const);
  switch (step) {
    case 'provider':
      return ['providerId'];
    case 'location':
      return ['location'];
    case 'stay':
      return ['arrival', 'departure', 'adults', ...params(fields.watch), 'maxPrice'];
    case 'alerts':
      return ['checkIntervalMinutes', ...(autoHold ? params(fields.hold) : [])];
    default:
      return ['name', 'notes'];
  }
}
