import { useId, type ReactNode } from 'react';
import { useFormContext } from 'react-hook-form';
import type {
  ProviderManifest,
  StayFieldDescriptor as StayField,
} from '../../../../../shared/types/provider.types';
import { formatPrice } from '../../../../components/nightGridModel';
import {
  stayNightsLabel,
  partyLabel,
  stayDatesLabel,
} from '../../../../components/stay/stayFormat';
import type { UnitNoun } from '../../../../components/stay/UnitPicker';
import {
  Button,
  Field,
  Notice,
  ProviderBadge,
  TextField,
  Textarea,
} from '../../../../components/ui';
import {
  intervalLabel,
  parsePrice,
  watchStayFields,
  type WatchFormValues,
} from '../../form/watchFormSchema';
import { PlacePhoto, type PhotoPlace } from '../../../../components/PlacePhoto';

export type FlowStepId = 'provider' | 'location' | 'stay' | 'alerts' | 'review';

export interface ReviewStepProps {
  manifest: ProviderManifest;
  today: string;
  noun: UnitNoun;
  /** The chosen place as the catalogue has it, for its photo. */
  place?: PhotoPlace;
  placeLoading?: boolean;
  onChangeStep: (step: FlowStepId) => void;
  /** Why the last attempt to create the watch failed. */
  submitError?: string;
}

/** One group of the review, with the one "Change" that goes back to where it was chosen. */
function Section({
  title,
  changeLabel,
  onChange,
  children,
}: {
  title: string;
  /** The Change button's accessible name, e.g. "Change dates". */
  changeLabel: string;
  onChange: () => void;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 border-b border-border py-4 first:pt-0 last:border-0"
    >
      <div className="flex items-center justify-between gap-4">
        <h3 id={headingId} className="text-base font-semibold text-fg">
          {title}
        </h3>
        <Button variant="ghost" size="sm" onClick={onChange} aria-label={changeLabel}>
          Change
        </Button>
      </div>
      {children}
    </section>
  );
}

function Items({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">{children}</dl>;
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-fg-secondary">{label}</dt>
      <dd className="text-base text-fg">{children}</dd>
    </div>
  );
}

/** A provider stay field's value as the person chose it ("Tent", "Yes", "Not given"). */
function fieldValue(field: StayField, value: unknown): string {
  const option = field.options?.find((o) => o.value === value)?.label;
  if (option) return option;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return value === undefined || value === '' ? 'Not given' : String(value);
}

/**
 * Step 5: what was chosen, grouped as Where, When, Who and Alerts, each with one way back to
 * change it; then the name and notes.
 */
export function ReviewStep({
  manifest,
  today,
  noun,
  place,
  placeLoading,
  onChangeStep,
  submitError,
}: ReviewStepProps) {
  const { register, getValues, formState } = useFormContext<WatchFormValues>();
  const v = getValues();
  const fields = watchStayFields(manifest);
  const price = parsePrice(v.maxPrice);
  const fieldItems = (list: readonly StayField[]) =>
    list.map((field) => (
      <Item key={field.key} label={field.label}>
        {fieldValue(field, v.stayParams[field.key])}
      </Item>
    ));

  return (
    <>
      <div className="flex flex-col">
        <Section
          title="Where"
          changeLabel="Change location"
          onChange={() => onChangeStep('location')}
        >
          <div className="flex items-center gap-4">
            <PlacePhoto
              name={v.location?.name ?? 'The place'}
              place={place}
              loading={placeLoading}
              className="aspect-4/3 w-28 rounded-md"
            />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-base font-semibold text-fg">{v.location?.name}</p>
              {v.location?.areaName && (
                <p className="text-sm text-fg-secondary">{v.location.areaName}</p>
              )}
              <ProviderBadge providerId={manifest.id} info={manifest} size="sm" className="w-fit" />
            </div>
          </div>
        </Section>
        <Section title="When" changeLabel="Change dates" onChange={() => onChangeStep('stay')}>
          <Items>
            <Item label="Dates">
              {v.arrival && v.departure
                ? `${stayDatesLabel(v.arrival, v.departure, today)} · ${stayNightsLabel(v.arrival, v.departure)}`
                : 'Not chosen'}
            </Item>
          </Items>
        </Section>
        <Section title="Who" changeLabel="Change guests" onChange={() => onChangeStep('stay')}>
          <Items>
            <Item label="Guests">{partyLabel(v)}</Item>
            {fieldItems(fields.watch)}
            <Item label={`Preferred ${noun.many}`}>
              {v.unitIds.length ? `${v.unitIds.length} chosen` : `Any ${noun.one}`}
            </Item>
            <Item label="Max price per night">
              {price !== undefined ? formatPrice(price, manifest.currency) : 'No limit'}
            </Item>
          </Items>
        </Section>
        <Section title="Alerts" changeLabel="Change alerts" onChange={() => onChangeStep('alerts')}>
          <Items>
            <Item label="Checks">{intervalLabel(v.checkIntervalMinutes, manifest)}</Item>
            <Item label="Alert me">
              {v.allowPartialMatch
                ? 'Also when only some nights are free'
                : 'Only when the whole stay is free'}
              , {v.notifyOnly ? 'stops after the first alert' : 'keeps checking after alerts'}
            </Item>
            {manifest.capabilities.holds && (
              <Item label="Automatic hold">
                {v.autoHold ? `Hold a ${noun.one} when found` : 'Off'}
              </Item>
            )}
            {v.autoHold && fieldItems(fields.hold)}
          </Items>
        </Section>
      </div>
      <Field
        label="Name"
        hint="Shown in your list and alerts."
        error={formState.errors.name?.message}
      >
        <TextField autoComplete="off" {...register('name')} />
      </Field>
      <Field label="Notes" optional error={formState.errors.notes?.message}>
        <Textarea rows={3} {...register('notes')} />
      </Field>
      {submitError && (
        <Notice tone="danger" title="The watch couldn't be created">
          {submitError}
        </Notice>
      )}
    </>
  );
}

export default ReviewStep;
