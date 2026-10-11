/**
 * Between the watch form and the watches contract (V4): a new form, a form for an existing
 * watch, and what create and update send. Calendar dates stay `YYYY-MM-DD` strings throughout;
 * no user id (main resolves the local profile). Pure.
 */
import type { ProviderManifest, StayParams } from '../../../../shared/types/provider.types';
import type { Watch, WatchInput, WatchUpdate } from '../../../../shared/types/watch.types';
import type { LocationChoice } from '../../../components/LocationCombobox';
import {
  stayFieldDefaults,
  storedStayFieldValue,
  toStayParams,
  type StayFieldValues,
} from '../../../components/stay/stayFields';
import { stayDatesLabel } from '../../../components/stay/stayFormat';
import {
  defaultInterval,
  parsePrice,
  watchStayFields,
  type WatchFormValues,
} from './watchFormSchema';

/** "Osprey Bay · Fri 11 – Sun 13 Dec": what a new watch is called until the person names it. */
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

/** A blank form for a provider (its stay field defaults), or for no provider yet. */
export function emptyWatchForm(manifest: ProviderManifest | undefined): WatchFormValues {
  const fields = watchStayFields(manifest);
  return {
    providerId: manifest?.id ?? '',
    location: null,
    arrival: '',
    departure: '',
    adults: 2,
    children: 0,
    infants: 0,
    stayParams: stayFieldDefaults([...fields.watch, ...fields.hold]),
    unitIds: [],
    maxPrice: '',
    checkIntervalMinutes: defaultInterval(manifest),
    allowPartialMatch: false,
    notifyOnly: true,
    autoHold: false,
    name: '',
    notes: '',
  };
}

/** The fields whose values are sent: the watch's, plus the hold's while auto-hold is on. */
function sentFields(values: WatchFormValues, manifest: ProviderManifest | undefined) {
  const fields = watchStayFields(manifest);
  return values.autoHold ? [...fields.watch, ...fields.hold] : fields.watch;
}

function stayOf(values: WatchFormValues, concessions?: number): WatchInput['stay'] {
  return {
    arrival: values.arrival,
    departure: values.departure,
    adults: values.adults,
    ...(values.children > 0 ? { children: values.children } : {}),
    ...(values.infants > 0 ? { infants: values.infants } : {}),
    ...(concessions ? { concessions } : {}),
  };
}

function locationOf(location: LocationChoice): WatchInput['location'] {
  return {
    externalId: location.externalId,
    name: location.name,
    ...(location.areaName ? { areaName: location.areaName } : {}),
  };
}

/** What `watches.create` gets. `values` must have passed the schema. */
export function toWatchInput(
  values: WatchFormValues,
  manifest: ProviderManifest | undefined
): WatchInput {
  if (!values.location) throw new Error('A watch needs a location');
  const stayParams = toStayParams(sentFields(values, manifest), values.stayParams);
  const maxPrice = parsePrice(values.maxPrice);
  const notes = values.notes.trim();
  return {
    providerId: values.providerId,
    name: values.name.trim(),
    location: locationOf(values.location),
    stay: stayOf(values),
    ...(values.unitIds.length ? { unitIds: values.unitIds } : {}),
    ...(Object.keys(stayParams).length ? { stayParams } : {}),
    checkIntervalMinutes: values.checkIntervalMinutes,
    ...(manifest?.capabilities.holds && values.autoHold ? { autoHold: true } : {}),
    notifyOnly: values.notifyOnly,
    allowPartialMatch: values.allowPartialMatch,
    ...(maxPrice !== undefined ? { maxPrice } : {}),
    ...(notes ? { notes } : {}),
  };
}

/** The form for an existing watch, and notes on stored values it had to change. */
export function fromWatch(
  watch: Watch,
  manifest: ProviderManifest | undefined
): { values: WatchFormValues; notes: Partial<Record<string, string>> } {
  const fields = watchStayFields(manifest);
  const stayParams: StayFieldValues = {};
  const notes: Partial<Record<string, string>> = {};
  for (const field of [...fields.watch, ...fields.hold]) {
    const { value, note } = storedStayFieldValue(field, watch.stayParams[field.key]);
    stayParams[field.key] = value;
    if (note) notes[field.key] = note;
  }
  return {
    values: {
      providerId: watch.providerId,
      location: { ...watch.location },
      arrival: watch.stay.arrival,
      departure: watch.stay.departure,
      adults: watch.stay.adults,
      children: watch.stay.children,
      infants: watch.stay.infants,
      stayParams,
      unitIds: [...watch.unitIds],
      maxPrice: watch.maxPrice ? String(watch.maxPrice) : '',
      checkIntervalMinutes: watch.checkIntervalMinutes,
      allowPartialMatch: watch.allowPartialMatch,
      notifyOnly: watch.notifyOnly,
      autoHold: watch.autoHold,
      name: watch.name,
      notes: watch.notes ?? '',
    },
    notes,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What `watches.update` gets: only what changed from `initial` (so an untouched stay that has
 * started, or an old stored value, is never re-checked). Stay params go whenever they or
 * auto-hold change, keeping stored keys the provider does not declare. A cleared max price is
 * sent as 0, which main stores as none.
 */
export function toWatchUpdate(
  values: WatchFormValues,
  initial: WatchFormValues,
  watch: Watch,
  manifest: ProviderManifest | undefined
): WatchUpdate {
  const update: WatchUpdate = {};
  if (values.name.trim() !== initial.name.trim()) update.name = values.name.trim();
  if (values.location && !same(values.location, initial.location)) {
    update.location = locationOf(values.location);
  }
  const stayKeys = ['arrival', 'departure', 'adults', 'children', 'infants'] as const;
  if (stayKeys.some((key) => values[key] !== initial[key])) {
    update.stay = stayOf(values, watch.stay.concessions);
  }
  if (!same(values.unitIds, initial.unitIds)) update.unitIds = values.unitIds;
  if (!same(values.stayParams, initial.stayParams) || values.autoHold !== initial.autoHold) {
    const declared = new Set((manifest?.stayFields ?? []).map((field) => field.key));
    const kept: StayParams = Object.fromEntries(
      Object.entries(watch.stayParams).filter(([key]) => !declared.has(key))
    );
    update.stayParams = {
      ...kept,
      ...toStayParams(sentFields(values, manifest), values.stayParams),
    };
  }
  if (values.checkIntervalMinutes !== initial.checkIntervalMinutes) {
    update.checkIntervalMinutes = values.checkIntervalMinutes;
  }
  if (values.autoHold !== initial.autoHold) update.autoHold = values.autoHold;
  if (values.notifyOnly !== initial.notifyOnly) update.notifyOnly = values.notifyOnly;
  if (values.allowPartialMatch !== initial.allowPartialMatch) {
    update.allowPartialMatch = values.allowPartialMatch;
  }
  if (values.maxPrice.trim() !== initial.maxPrice.trim()) {
    update.maxPrice = parsePrice(values.maxPrice) ?? 0;
  }
  if (values.notes.trim() !== initial.notes.trim()) update.notes = values.notes.trim();
  return update;
}
