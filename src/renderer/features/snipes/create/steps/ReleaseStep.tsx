import { useFormContext } from 'react-hook-form';
import { SnipeReleaseMode } from '../../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../../shared/types/provider.types';
import type { UnitNoun } from '../../../../components/stay/UnitPicker';
import { Field, RadioCard, RadioCardGroup, TextField } from '../../../../components/ui';
import type { SnipeFormValues } from '../snipeForm';
import { isComputedMode, useReleasePreview } from '../useReleasePreview';
import { inZoneAndLocal, zonedInstant, zoneName } from '../zonedTime';
import { AdvancedTiming } from './AdvancedTiming';

export interface ReleaseStepProps {
  manifest: ProviderManifest;
  noun: UnitNoun;
  /** The place's release rule in words (`LocationDetail.releaseInfo`), when the provider has one. */
  releaseInfo?: string;
  now: Date;
}

/**
 * Step 4: when the sites are released, as the provider describes its modes (§12.3). The place's
 * release rule leads, and a computed mode previews when the stay's first night opens, from the
 * provider's own check. A scheduled release asks for its date and time where the place is.
 */
export function ReleaseStep({ manifest, noun, releaseInfo, now }: ReleaseStepProps) {
  const { register, watch, setValue, formState, getFieldState, trigger } =
    useFormContext<SnipeFormValues>();
  // The date and time are checked together, on the date: a new time re-checks a date's error.
  const recheckDate = () => {
    if (getFieldState('releaseDate').error) void trigger('releaseDate');
  };
  const { errors } = formState;
  const [location, arrival, departure, adults, stayParams, releaseMode, date, time] = watch([
    'location',
    'arrival',
    'departure',
    'adults',
    'stayParams',
    'releaseMode',
    'releaseDate',
    'releaseTime',
  ]);
  const modes = manifest.releaseModes ?? [];
  const preview = useReleasePreview(
    manifest,
    { location, arrival, departure, adults, stayParams },
    noun,
    now
  );
  const scheduledAt = zonedInstant(date, time, manifest.timezone);
  const zone = zoneName(manifest.timezone, scheduledAt ?? now);

  return (
    <>
      <RadioCardGroup
        label="When are the sites released?"
        hint={releaseInfo ? `${location?.name ?? 'This place'}: ${releaseInfo}` : undefined}
        value={releaseMode}
        onValueChange={(id) =>
          setValue('releaseMode', id, { shouldDirty: true, shouldValidate: true })
        }
      >
        {modes.map((mode) => (
          <RadioCard
            key={mode.id}
            value={mode.id}
            title={mode.label}
            description={
              isComputedMode(mode.id) ? (
                <>
                  <span className="block">{mode.description}</span>
                  <span className="mt-1 block font-semibold text-fg">{preview}</span>
                </>
              ) : (
                mode.description
              )
            }
          />
        ))}
      </RadioCardGroup>
      {errors.releaseMode && (
        <p role="alert" className="text-sm text-danger">
          {errors.releaseMode.message}
        </p>
      )}
      {releaseMode === SnipeReleaseMode.SCHEDULED && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Release date"
            hint={`The day the dates open, ${manifest.shortName} time.`}
            error={errors.releaseDate?.message}
          >
            <TextField type="date" {...register('releaseDate')} />
          </Field>
          <Field
            label={`Release time (${zone})`}
            hint={scheduledAt ? inZoneAndLocal(scheduledAt, manifest.timezone, now) : undefined}
          >
            <TextField type="time" {...register('releaseTime', { onChange: recheckDate })} />
          </Field>
        </div>
      )}
      <AdvancedTiming manifest={manifest} />
    </>
  );
}

export default ReleaseStep;
