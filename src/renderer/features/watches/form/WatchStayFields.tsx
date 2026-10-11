import { useFormContext } from 'react-hook-form';
import type { UnitSummary } from '../../../../shared/types/catalog.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { ProviderStayFields } from '../../../components/stay/ProviderStayFields';
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
}

/** Dates, guests, the provider's own stay fields, units and price: the Stay step, and Edit. */
export function WatchStayFields({
  manifest,
  today,
  units,
  noun,
  fieldNotes,
}: WatchStayFieldsProps) {
  const { register, watch, formState } = useFormContext<WatchFormValues>();
  const set = useSetWatchField();
  const setFields = useSetWatchFields();
  const { errors } = formState;
  const [arrival, departure, adults, children, infants, stayParams, unitIds] = watch([
    'arrival',
    'departure',
    'adults',
    'children',
    'infants',
    'stayParams',
    'unitIds',
  ]);
  const fields = watchStayFields(manifest).watch;
  const provider = manifest?.shortName ?? 'the provider';

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
      {units && units.length > 0 && (
        <UnitPicker
          units={units}
          value={unitIds}
          onChange={(ids) => set('unitIds', ids)}
          noun={noun}
          hint={`Leave all unticked to be told about any ${noun.one}.`}
        />
      )}
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
