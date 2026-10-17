import { useFormContext } from 'react-hook-form';
import { SnipeReleaseMode } from '../../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../../shared/types/provider.types';
import type { SnipeAction } from '../../../../../shared/types/site-sniper.types';
import type { UnitNoun } from '../../../../components/stay/UnitPicker';
import { Field, RadioCard, RadioCardGroup, TextField } from '../../../../components/ui';
import { cx } from '../../../../components/ui/cx';
import { windowCapMinutes } from '../snipeAction';
import type { SnipeFormValues } from '../snipeForm';
import { isComputedMode, useReleasePreview } from '../useReleasePreview';
import { inZoneAndLocal, zonedInstant, zoneName } from '../zonedTime';
import { AdvancedTiming } from './AdvancedTiming';

export interface ReleaseStepProps {
  manifest: ProviderManifest;
  noun: UnitNoun;
  /** The place's release rule in words (`LocationDetail.releaseInfo`), when the provider has one. */
  releaseInfo?: string;
  /**
   * Why the provider could not time this stay in the chosen mode, from a refused create (its
   * `VALIDATION` on `releaseAt`): shown in place of the preview's guess.
   */
  refusal?: string;
  now: Date;
}

/**
 * What the snipe does when the dates are free: "Alert me" or "Hold it for me" where the provider
 * places holds (RS9), with the hold rule's message when a hold would have to choose between stay
 * types; one line saying it alerts where it does not.
 */
function WhenFree({ manifest, noun }: { manifest: ProviderManifest; noun: UnitNoun }) {
  const { watch, setValue, formState } = useFormContext<SnipeFormValues>();
  const action = watch('action');
  const provider = manifest.shortName;
  if (manifest.capabilities.holds !== true) {
    return (
      <p className="text-sm text-fg-secondary">
        When the dates are free, Site Sniper alerts you with a link to book on {provider}. Automatic
        holds aren&apos;t available for {provider}.
      </p>
    );
  }
  return (
    <RadioCardGroup
      label="When the dates are free"
      value={action}
      onValueChange={(next) =>
        setValue('action', next as SnipeAction, { shouldDirty: true, shouldValidate: true })
      }
      error={formState.errors.action?.message}
    >
      <RadioCard
        value="alert"
        title="Alert me"
        description={`A desktop alert and email with a link to book on ${provider}. Nothing is held, so book it before someone else does.`}
      />
      <RadioCard
        value="hold"
        title="Hold it for me"
        description={`Holds a ${noun.one} for you, then you pay on ${provider}'s page in WA Stay.`}
      />
    </RadioCardGroup>
  );
}

/**
 * Step 4: when the units are released, as the provider describes its modes (§12.3). The place's
 * release rule leads, and a computed mode previews when the stay's first night opens, from the
 * provider's own check. A scheduled release asks for its date and time where the place is. Then
 * what happens when the dates are free (`WhenFree`), and the advanced timing, whose window is
 * checked again when a mode with a limit is chosen.
 */
export function ReleaseStep({ manifest, noun, releaseInfo, refusal, now }: ReleaseStepProps) {
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
        label={`When are the ${noun.many} released?`}
        hint={releaseInfo ? `${location?.name ?? 'This place'}: ${releaseInfo}` : undefined}
        value={releaseMode}
        onValueChange={(id) => {
          setValue('releaseMode', id, { shouldDirty: true, shouldValidate: true });
          // A mode's limit on the window (`maxWindowMinutes`) applies at once
          if (windowCapMinutes(manifest, id) !== undefined || getFieldState('windowMinutes').error)
            void trigger('windowMinutes');
        }}
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
                  {refusal && mode.id === releaseMode ? (
                    <span className="mt-1 block font-semibold text-danger">{refusal}</span>
                  ) : (
                    <span className="mt-1 block font-semibold text-fg">{preview}</span>
                  )}
                </>
              ) : (
                mode.description
              )
            }
          />
        ))}
      </RadioCardGroup>
      {errors.releaseMode && (
        // Said once on screen: a refusal shown in its card is announced here only
        <p
          role="alert"
          className={cx('text-sm text-danger', errors.releaseMode.message === refusal && 'sr-only')}
        >
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
      <WhenFree manifest={manifest} noun={noun} />
      <AdvancedTiming manifest={manifest} />
    </>
  );
}

export default ReleaseStep;
