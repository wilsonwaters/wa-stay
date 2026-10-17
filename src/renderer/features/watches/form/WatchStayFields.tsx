import { useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import type { UnitSummary } from '../../../../shared/types/catalog.types';
import type { ProviderManifest, UnitKind } from '../../../../shared/types/provider.types';
import { MinStayNotice } from '../../../components/stay/MinStayNotice';
import { ProviderStayFields } from '../../../components/stay/ProviderStayFields';
import { StayTypeChips } from '../../../components/stay/StayTypeChips';
import { placeUnitKinds, stayTypeOptions } from '../../../components/stay/stayTypes';
import { UnitPicker, type UnitNoun } from '../../../components/stay/UnitPicker';
import { DateRangeField, Field, GuestsField, TextField } from '../../../components/ui';
import { useSetWatchField, useSetWatchFields } from './useSetWatchField';
import { watchStayFields, type WatchFormValues } from './watchFormSchema';

export interface WatchStayFieldsProps {
  manifest: ProviderManifest | undefined;
  /** Today in the provider's time zone: the earliest check-in. */
  today: string;
  /** The location's units, when known; without them there is no unit choice. */
  units?: readonly UnitSummary[];
  noun: UnitNoun;
  /** Notes on stored values that had to change (Edit), by stay field key. */
  fieldNotes?: Partial<Record<string, string>>;
  /**
   * Edit: the watch's stored stay types, offered for the life of the form even where the place
   * no longer has them, so turning one off never takes its chip (and the focus) away.
   */
  keepKinds?: readonly UnitKind[];
}

/**
 * Dates, guests, the provider's own stay fields, stay types (at a place whose units are of more
 * than one kind), units and price: the Stay step, and Edit. A warning says when the stay is
 * shorter than the units take (`MinStayNotice`).
 */
export function WatchStayFields({
  manifest,
  today,
  units,
  noun,
  fieldNotes,
  keepKinds = [],
}: WatchStayFieldsProps) {
  const { register, watch, formState, getFieldState, trigger } = useFormContext<WatchFormValues>();
  const set = useSetWatchField();
  const setFields = useSetWatchFields();
  const { errors } = formState;
  const [arrival, departure, adults, children, infants, stayParams, unitIds, unitKinds, location] =
    watch([
      'arrival',
      'departure',
      'adults',
      'children',
      'infants',
      'stayParams',
      'unitIds',
      'unitKinds',
      'location',
    ]);
  const fields = watchStayFields(manifest).watch;
  const provider = manifest?.shortName ?? 'the provider';
  const placeKinds = useMemo(() => (units ? placeUnitKinds(units) : undefined), [units]);
  const stayTypes = placeKinds ? stayTypeOptions(placeKinds, [...unitKinds, ...keepKinds]) : [];
  // An automatic hold needs a stay type or a unit at a mixed place (Alerts): once that error
  // shows, a new choice here checks it again.
  const recheckHold = () => {
    if (getFieldState('autoHold').error) void trigger('autoHold');
  };

  return (
    <>
      <DateRangeField
        label="Dates"
        value={{ arrival: arrival || undefined, departure: departure || undefined }}
        onChange={(range) =>
          setFields(['arrival', range.arrival ?? ''], ['departure', range.departure ?? ''])
        }
        minDate={today}
        error={errors.arrival?.message ?? errors.departure?.message}
      />
      <GuestsField
        label="Guests"
        value={{ adults, children, infants }}
        onChange={(guests) =>
          setFields(
            ['adults', guests.adults],
            ['children', guests.children],
            ['infants', guests.infants]
          )
        }
        error={errors.adults?.message}
      />
      <ProviderStayFields
        fields={fields}
        values={stayParams}
        onChange={(key, value) => set(`stayParams.${key}`, value)}
        errors={Object.fromEntries(
          fields.map((field) => [field.key, errors.stayParams?.[field.key]?.message])
        )}
        notes={fieldNotes}
      />
      {stayTypes.length > 0 && (
        <StayTypeChips
          options={stayTypes}
          value={unitKinds}
          onChange={(kinds) => {
            set('unitKinds', kinds);
            recheckHold();
          }}
        />
      )}
      {units && units.length > 0 && (
        <UnitPicker
          units={units}
          value={unitIds}
          onChange={(ids) => {
            set('unitIds', ids);
            recheckHold();
          }}
          noun={noun}
          hint={`Leave all unticked to be told about any ${noun.one}.`}
          kinds={stayTypes.length > 0 ? unitKinds : undefined}
        />
      )}
      <MinStayNotice
        units={units}
        unitIds={unitIds}
        unitKinds={stayTypes.length > 0 ? unitKinds : undefined}
        arrival={arrival}
        departure={departure}
        place={location?.name}
        noun={noun}
        shortName={provider}
        action="alerts on"
      />
      <Field
        label="Max price per night"
        optional
        hint={`In dollars. Applied only when ${provider} shows a price for every night.`}
        error={errors.maxPrice?.message}
      >
        <TextField inputMode="decimal" autoComplete="off" {...register('maxPrice')} />
      </Field>
    </>
  );
}

export default WatchStayFields;
