/**
 * The new-snipe form: its values, the rules each step checks (zod, with the provider's own stay
 * field rules), and a blank form for a provider. Advanced timing is typed as text (seconds and
 * minutes, as people think of them) and becomes the contract's ms fields on submit. `action`
 * (alert or hold, `snipeAction.ts`) is chosen on the Release step.
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
  UNIT_KINDS,
  type ProviderManifest,
  type StayFieldDescriptor,
  type UnitKind,
} from '../../../../shared/types/provider.types';
import { SNIPE_ACTIONS } from '../../../../shared/types/site-sniper.types';
import { DEFAULT_UNIT_NOUN, type UnitNoun } from '../../../components/nightGridModel';
import {
  stayFieldDefaults,
  stayFieldIssue,
  stayFieldsFor,
} from '../../../components/stay/stayFields';
import { holdNeedsChoice } from '../../../components/stay/stayTypes';
import { defaultSnipeAction, snipeHoldChoiceMessage, windowCapMinutes } from './snipeAction';
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
  /** The stay types wanted, in stay-type order; none means any. */
  unitKinds: z.array(z.enum(UNIT_KINDS)),
  /** A `releaseModes` id of the provider. */
  releaseMode: z.string(),
  /** What the snipe does when the dates are free: alert, or hold (where the provider can). */
  action: z.enum(SNIPE_ACTIONS),
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
    unitKinds: [],
    releaseMode: manifest?.releaseModes?.[0]?.id ?? '',
    action: defaultSnipeAction(manifest),
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
  /**
   * The kinds of the place's units (`placeUnitKinds`), once its detail has loaded. A snipe that
   * holds needs a stay type or a unit at a mixed place; without them nothing is enforced here
   * (main then alerts instead of holding). An alert needs neither.
   */
  placeKinds?: readonly UnitKind[];
  /** What a unit is called here, for the hold rule's message. */
  noun?: UnitNoun;
}

/** Midnight of check-in day where the provider is (epoch ms), or never when there is no date. */
function checkInAt(arrival: string, timeZone: string): number {
  return zonedInstant(arrival, '00:00', timeZone)?.getTime() ?? Number.POSITIVE_INFINITY;
}

/** The form's rules for one provider. */
export function snipeFormSchema({
  manifest,
  today,
  now,
  placeKinds,
  noun = DEFAULT_UNIT_NOUN,
}: SnipeFormContext) {
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
    if (v.action === 'hold' && placeKinds && holdNeedsChoice(placeKinds, v.unitKinds, v.unitIds)) {
      issue(['action'], snipeHoldChoiceMessage(noun));
    }

    if (!modes.some((mode) => mode.id === v.releaseMode)) {
      issue(['releaseMode'], `Choose when the ${noun.many} are released`);
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
    // The mode's limit (`maxWindowMinutes`), in the provider's words
    const cap = windowCapMinutes(manifest, v.releaseMode) ?? 1440;
    if (!continuous && (window === undefined || window < 1 || window > 1440)) {
      issue(['windowMinutes'], 'Enter whole minutes, from 1 to 1440');
    } else if (!continuous && manifest && window !== undefined && window > cap) {
      issue(['windowMinutes'], `${manifest.shortName} allows at most ${cap} minutes`);
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
        'action',
        'leadTimeSeconds',
        'pollIntervalSeconds',
        'windowMinutes',
        'maxAttempts',
      ];
    default:
      return ['name', 'notes'];
  }
}
