import type { ReactNode } from 'react';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { LocationCombobox } from '../../../components/LocationCombobox';
import { unitNoun } from '../../../components/locationFormat';
import { DateRangeField, Field, GuestsField, TextField, Textarea } from '../../../components/ui';
import type { AddBookingErrors, AddBookingValues } from './addBookingForm';

/** Two fields side by side from `sm`, one above the other when narrow. */
const PAIR = 'grid items-start gap-6 sm:grid-cols-2';

export interface BookingDetailsFieldsProps {
  manifest: ProviderManifest;
  values: AddBookingValues;
  onChange: (patch: Partial<AddBookingValues>) => void;
  errors: AddBookingErrors;
  /** Replaces the reference error, e.g. "Already in your bookings" with a link. */
  referenceError?: ReactNode;
}

/**
 * The details step: where (the provider's catalogue when it has one, else free text), when,
 * who, and what the provider's confirmation says. Past dates are allowed: a trip already taken
 * can be recorded too.
 */
export function BookingDetailsFields({
  manifest,
  values,
  onChange,
  errors,
  referenceError,
}: BookingDetailsFieldsProps) {
  const noun = unitNoun(manifest.locationKinds[0]).one;
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  const currency = manifest.currency ?? 'AUD';

  return (
    <>
      {manifest.capabilities.catalog ? (
        <LocationCombobox
          providerId={manifest.id}
          providerName={manifest.shortName}
          value={values.location}
          onChange={(location) =>
            onChange({
              location,
              ...(location?.areaName && !values.areaName.trim()
                ? { areaName: location.areaName }
                : {}),
            })
          }
          error={errors.location}
        />
      ) : (
        <Field label="Location" error={errors.location}>
          <TextField
            autoComplete="off"
            value={values.locationName}
            onChange={(event) => onChange({ locationName: event.target.value })}
          />
        </Field>
      )}
      <Field label="Area" optional hint="The park, town or region it is in.">
        <TextField
          autoComplete="off"
          value={values.areaName}
          onChange={(event) => onChange({ areaName: event.target.value })}
        />
      </Field>
      {/* Paired on wide windows: when and who, then what the confirmation says. */}
      <div className={PAIR}>
        <DateRangeField
          label="Dates"
          value={{ arrival: values.arrival || undefined, departure: values.departure || undefined }}
          onChange={(range) =>
            onChange({ arrival: range.arrival ?? '', departure: range.departure ?? '' })
          }
          error={errors.dates}
        />
        <GuestsField
          label="Guests"
          value={{ adults: values.adults, children: values.children, infants: values.infants }}
          onChange={(guests) => onChange(guests)}
          error={errors.adults}
        />
      </div>
      <div className={PAIR}>
        <Field
          label={Noun}
          optional
          hint={`As on your confirmation, e.g. ${Noun} 12.`}
          error={errors.unit}
        >
          <TextField
            autoComplete="off"
            value={values.unit}
            onChange={(event) => onChange({ unit: event.target.value })}
          />
        </Field>
        <Field
          label="Booking reference"
          hint={`From your ${manifest.shortName} confirmation.`}
          error={referenceError ?? errors.reference}
          required
        >
          <TextField
            autoComplete="off"
            spellCheck={false}
            value={values.reference}
            onChange={(event) => onChange({ reference: event.target.value })}
          />
        </Field>
      </div>
      <Field label="Total cost" optional hint={`In ${currency}.`} error={errors.totalCost}>
        <TextField
          inputMode="decimal"
          autoComplete="off"
          value={values.totalCost}
          onChange={(event) => onChange({ totalCost: event.target.value })}
        />
      </Field>
      <Field label="Notes" optional error={errors.notes}>
        <Textarea
          rows={3}
          value={values.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
        />
      </Field>
    </>
  );
}

export default BookingDetailsFields;
