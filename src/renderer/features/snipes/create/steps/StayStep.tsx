import { useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import type { UnitSummary } from '../../../../../shared/types/catalog.types';
import type { ProviderManifest } from '../../../../../shared/types/provider.types';
import { MinStayNotice } from '../../../../components/stay/MinStayNotice';
import { ProviderStayFields } from '../../../../components/stay/ProviderStayFields';
import { StayTypeChips } from '../../../../components/stay/StayTypeChips';
import { placeUnitKinds, stayTypeOptions } from '../../../../components/stay/stayTypes';
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
 * postcode…), the stay types at a place whose units are of more than one kind, and the
 * preferred units: none chosen means any unit. A snipe that holds needs a stay type or a unit
 * at such a place, which the Release step asks for where "Hold it for me" is chosen; changing
 * either here checks that rule again once its message shows. Warnings say when the stay is
 * shorter than the units take (`MinStayNotice`), or the party more than they hold.
 */
export function StayStep({ manifest, today, units, noun }: StayStepProps) {
  const { watch, formState, getFieldState, trigger } = useFormContext<SnipeFormValues>();
  const set = useSetSnipeField();
  const setFields = useSetSnipeFields();
  const { errors } = formState;
  const [
    arrival,
    departure,
    adults,
    children,
    infants,
    stayParams,
    unitIds,
    unitKinds,
    location,
    action,
  ] = watch([
    'arrival',
    'departure',
    'adults',
    'children',
    'infants',
    'stayParams',
    'unitIds',
    'unitKinds',
    'location',
    'action',
  ]);
  const holds = action === 'hold';
  // A unit or a stay type meets the hold rule: check it again once its message shows.
  const recheckHoldRule = () => {
    if (getFieldState('action').error) void trigger('action');
  };
  const fields = snipeStayFields(manifest);
  const placeKinds = useMemo(() => (units ? placeUnitKinds(units) : undefined), [units]);
  const stayTypes = placeKinds ? stayTypeOptions(placeKinds, unitKinds) : [];
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
        hint={`The nights you want${holds ? ' to hold' : ''}, even if they aren't released yet.`}
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
      {stayTypes.length > 0 && (
        <StayTypeChips
          options={stayTypes}
          value={unitKinds}
          onChange={(kinds) => {
            set('unitKinds', kinds);
            recheckHoldRule();
          }}
        />
      )}
      {units && units.length > 0 && (
        <UnitPicker
          units={units}
          value={unitIds}
          onChange={(ids) => {
            set('unitIds', ids);
            recheckHoldRule();
          }}
          noun={noun}
          hint={
            holds
              ? `Leave all unticked and Site Sniper holds the first ${noun.one} that comes free.`
              : `Leave all unticked and Site Sniper alerts you to the first ${noun.one} that comes free.`
          }
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
        shortName={manifest.shortName}
        action={holds ? 'holds' : 'alerts on'}
      />
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
