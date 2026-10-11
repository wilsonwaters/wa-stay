import { useId, type ReactNode } from 'react';
import { useFormContext } from 'react-hook-form';
import type { ProviderManifest } from '../../../../../shared/types/provider.types';
import { ConnectAccountPrompt } from '../../../../components/accounts/ConnectAccountPrompt';
import { PlacePhoto, type PhotoPlace } from '../../../../components/PlacePhoto';
import {
  partyLabel,
  stayDatesLabel,
  stayNightsLabel,
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
import { stayFieldText } from '../../shared/snipeFormat';
import { snipeStayFields, type SnipeFormValues, type SnipeStepId } from '../snipeForm';
import { modeUsesQueue } from '../snipeFormMapping';

export interface ReviewStepProps {
  manifest: ProviderManifest;
  today: string;
  noun: UnitNoun;
  /** The chosen place as the catalogue has it, for its photo and unit names. */
  place?: PhotoPlace & { units?: { unitId: string; unitName: string }[] };
  placeLoading?: boolean;
  /** "At a scheduled time, Tue 3 Nov, 10:00 am AWST" or the mode's name and preview. */
  releaseSummary: string;
  onChangeStep: (step: SnipeStepId) => void;
  submitError?: string;
}

/** One group of the review, with the one "Change" that goes back to where it was chosen. */
function Section(props: {
  title: string;
  change: string;
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
          {props.title}
        </h3>
        <Button variant="ghost" size="sm" onClick={props.onChange} aria-label={props.change}>
          Change
        </Button>
      </div>
      {props.children}
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

/**
 * Step 5: what was chosen (Where, When and who, Release), the name and notes, a reminder to hold
 * only what will be used, and the provider's account: a blocking prompt where holds need one,
 * a gentle hint where it is optional (§12.32).
 */
export function ReviewStep(props: ReviewStepProps) {
  const { manifest, today, noun, place, placeLoading, releaseSummary, onChangeStep } = props;
  const { register, getValues, formState } = useFormContext<SnipeFormValues>();
  const v = getValues();
  const unitNames = v.unitIds.map(
    (id) => place?.units?.find((u) => u.unitId === id || u.unitName === id)?.unitName ?? id
  );
  const queue = modeUsesQueue(manifest, v.releaseMode) && v.accessGateEnabled;

  return (
    <>
      <div className="flex flex-col">
        <Section title="Where" change="Change location" onChange={() => onChangeStep('location')}>
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
        <Section title="Stay" change="Change your stay" onChange={() => onChangeStep('stay')}>
          <Items>
            <Item label="Dates">
              {v.arrival && v.departure
                ? `${stayDatesLabel(v.arrival, v.departure, today)} · ${stayNightsLabel(v.arrival, v.departure)}`
                : 'Not chosen'}
            </Item>
            <Item label="Guests">{partyLabel(v)}</Item>
            {snipeStayFields(manifest).map((field) => (
              <Item key={field.key} label={field.label}>
                {stayFieldText(field, v.stayParams[field.key])}
              </Item>
            ))}
            <Item label={`Preferred ${noun.many}`}>
              {unitNames.length ? unitNames.join(', ') : `Any ${noun.one}`}
            </Item>
          </Items>
        </Section>
        <Section
          title="Release"
          change="Change the release"
          onChange={() => onChangeStep('release')}
        >
          <Items>
            <Item label="When">{releaseSummary}</Item>
            {manifest.capabilities.accessGate && (
              <Item label="Queue">
                {queue ? `Uses the ${manifest.shortName} queue` : 'Not used'}
              </Item>
            )}
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
      <Notice tone="info" title="Book responsibly">
        Hold only what you will use. Payment is always completed by you on {manifest.shortName}.
      </Notice>
      <ConnectAccountPrompt
        manifest={manifest}
        message={
          manifest.capabilities.account === 'optional'
            ? `Connect ${manifest.shortName} before the release so checkout is quicker.`
            : `${manifest.shortName} needs you signed in before Site Sniper can hold a ${noun.one}. You can create the snipe now; it stays paused until you connect.`
        }
      />
      {props.submitError && (
        <Notice tone="danger" title="The snipe couldn't be created">
          {props.submitError}
        </Notice>
      )}
    </>
  );
}

export default ReviewStep;
