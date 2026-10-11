import { useFormContext } from 'react-hook-form';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { UnitNoun } from '../../../components/stay/UnitPicker';
import { Checkbox, Field, Select } from '../../../components/ui';
import { AutoHoldField } from './AutoHoldField';
import { intervalLabel, intervalOptions, type WatchFormValues } from './watchFormSchema';

export interface WatchAlertFieldsProps {
  manifest: ProviderManifest | undefined;
  noun: UnitNoun;
  /** Edit: the watch's stored interval, kept on offer even if the list no longer has it. */
  keepInterval?: number;
}

/** How often to check and what to do when something is found: the Alerts step, and Edit. */
export function WatchAlertFields({ manifest, noun, keepInterval }: WatchAlertFieldsProps) {
  const { register, formState } = useFormContext<WatchFormValues>();
  return (
    <>
      <Field
        label="Check every"
        hint="Checks run while WA Stay is open."
        error={formState.errors.checkIntervalMinutes?.message}
      >
        <Select {...register('checkIntervalMinutes', { valueAsNumber: true })}>
          {intervalOptions(manifest, keepInterval).map((minutes) => (
            <option key={minutes} value={minutes}>
              {intervalLabel(minutes, manifest)}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox
        label="Alert on partial availability"
        description="Also tell me when only some nights are free, such as 3 nights of a 14-night stay."
        {...register('allowPartialMatch')}
      />
      <Checkbox
        label="Stop watching after the first alert"
        description="Pauses the watch once it has told you something is free. Untick to keep checking."
        {...register('notifyOnly')}
      />
      {manifest?.capabilities.holds && <AutoHoldField manifest={manifest} noun={noun} />}
    </>
  );
}

export default WatchAlertFields;
