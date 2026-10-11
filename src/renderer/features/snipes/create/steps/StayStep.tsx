import { useFormContext } from 'react-hook-form';
import type { UnitSummary } from '../../../../../shared/types/catalog.types';
import type { ProviderManifest } from '../../../../../shared/types/provider.types';
import { ProviderStayFields } from '../../../../components/stay/ProviderStayFields';
import { choosesUnit, UnitPicker, type UnitNoun } from '../../../../components/stay/UnitPicker';
import { DateRangeField, GuestsField, Notice } from '../../../../components/ui';
import { snipeStayFields, type SnipeFormValues } from '../snipeForm';
import { useSetSnipeField, useSetSnipeFields } from '../useSetSnipeField';

/**
 * The most people the chosen units are known to hold, when every chosen unit says; undefined
 * when nothing is chosen or a unit does not say.
 */
export function chosenCapacity(
  units: readonly UnitSummary[],
  unitIds: readonly string[]
): number | undefined {
  const chosen = units.filter((unit) => choosesUnit(unitIds, unit));
  if (chosen.length === 0 || chosen.some((unit) => !unit.maxPeople)) return undefined;
  return Math.max(...chosen.map((unit) => unit.maxPeople ?? 0));
}

export interface StayStepProps {
  manifest: ProviderManifest;
  /** Today in the provider's time zone: the earliest check-in. */
  today: string;
  /** The location's units, when known; without them there is no unit choice. */
  units?: readonly UnitSummary[];
  noun: UnitNoun;
}

/**
 * Step 3: the dates, who is coming, the provider's own snipe and hold fields (vehicles,
 * postcode…), and the preferred units: none chosen means any unit.
 */
export function StayStep({ manifest, today, units, noun }: StayStepProps) {
  const { watch, formState } = useFormContext<SnipeFormValues>();
  const set = useSetSnipeField();
  const setFields = useSetSnipeFields();
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
  const fields = snipeStayFields(manifest);
  const capacity = units ? chosenCapacity(units, unitIds) : undefined;
  const party = adults + children + infants;

  return (
    <>
      <DateRangeField
        label="Dates"
        value={{ arrival: arrival || undefined, departure: departure || undefined }}
        onChange={(range) =>
          setFields(['arrival', range.arrival ?? ''], ['departure', range.departure ?? ''])
        }
        minDate={today}
        hint="The nights you want to hold, even if they aren't released yet."
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
      />
      {units && units.length > 0 && (
        <UnitPicker
          units={units}
          value={unitIds}
          onChange={(ids) => set('unitIds', ids)}
          noun={noun}
          hint={`Leave all unticked and Site Sniper holds the first ${noun.one} that comes free.`}
        />
      )}
      {capacity !== undefined && party > capacity && (
        <Notice tone="warning">
          Your party of {party} is more than the chosen {noun.many} are known to hold (up to{' '}
          {capacity}). You can still create the snipe; check the {noun.one} rules on{' '}
          {manifest.shortName}.
        </Notice>
      )}
    </>
  );
}

export default StayStep;
