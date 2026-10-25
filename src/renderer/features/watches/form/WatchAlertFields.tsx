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

/**
 * How often to check and what to do when something is found: the Alerts step, and Edit. A
 * stay free every night only by moving between units is alerted on only when asked (off by
 * default), and never held automatically.
 */
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
        label={`Alert on stays that move between ${noun.many}`}
        description={`Also tell me when every night is free, but not on one ${noun.one}. You'd move during your stay, and book more than once or through the place.${
          manifest?.capabilities.holds ? ' WA Stay never holds these automatically.' : ''
        }`}
        {...register('allowSplitStay')}
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
