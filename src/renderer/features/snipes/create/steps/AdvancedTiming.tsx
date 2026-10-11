import { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { SnipeReleaseMode } from '../../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../../shared/types/provider.types';
import { Checkbox, Disclosure, Field, TextField } from '../../../../components/ui';
import { MAX_POLL_SECONDS, MIN_POLL_SECONDS, type SnipeFormValues } from '../snipeForm';
import { modeUsesQueue } from '../snipeFormMapping';

const TIMING_FIELDS = [
  'leadTimeSeconds',
  'pollIntervalSeconds',
  'windowMinutes',
  'maxAttempts',
] as const;

/**
 * "Advanced timing", collapsed by default: how early to start, how often to check, how long to
 * keep trying and how many attempts, in seconds and minutes (the contract's ms on submit), and
 * the provider's queue where it has one (§12.2). It opens by itself when one of its fields has
 * an error, so the error is never hidden.
 */
export function AdvancedTiming({ manifest }: { manifest: ProviderManifest }) {
  const { register, watch, formState } = useFormContext<SnipeFormValues>();
  const [userOpen, setUserOpen] = useState(false);
  const { errors } = formState;
  const releaseMode = watch('releaseMode');
  const continuous = releaseMode === SnipeReleaseMode.CANCELLATION;
  const hasError = TIMING_FIELDS.some((name) => errors[name]);
  const queue = modeUsesQueue(manifest, releaseMode);

  return (
    <Disclosure summary="Advanced timing" open={userOpen || hasError} onOpenChange={setUserOpen}>
      <div className="flex flex-col gap-4 pt-2">
        {!continuous && (
          <Field
            label="Start early (seconds)"
            hint="How long before the release to get ready."
            error={errors.leadTimeSeconds?.message}
          >
            <TextField inputMode="numeric" autoComplete="off" {...register('leadTimeSeconds')} />
          </Field>
        )}
        <Field
          label="Check every (seconds)"
          hint={`From ${MIN_POLL_SECONDS} to ${MAX_POLL_SECONDS} seconds. ${manifest.shortName} may set a longer minimum.`}
          error={errors.pollIntervalSeconds?.message}
        >
          <TextField inputMode="decimal" autoComplete="off" {...register('pollIntervalSeconds')} />
        </Field>
        {!continuous && (
          <Field
            label="Keep trying for (minutes)"
            hint="How long after the release to keep trying."
            error={errors.windowMinutes?.message}
          >
            <TextField inputMode="numeric" autoComplete="off" {...register('windowMinutes')} />
          </Field>
        )}
        <Field label="Most attempts" hint="0 means no limit." error={errors.maxAttempts?.message}>
          <TextField inputMode="numeric" autoComplete="off" {...register('maxAttempts')} />
        </Field>
        {queue && (
          <Checkbox
            label={`Use ${manifest.shortName} queue`}
            description={`Joins ${manifest.shortName}'s queue before the release, so Site Sniper is through it the moment the dates open.`}
            {...register('accessGateEnabled')}
          />
        )}
      </div>
    </Disclosure>
  );
}

export default AdvancedTiming;
