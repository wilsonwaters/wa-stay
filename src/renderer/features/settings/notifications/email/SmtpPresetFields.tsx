import { Controller, useFormContext } from 'react-hook-form';
import { SMTPPreset } from '../../../../../shared/types/notifier.types';
import { Radio, RadioGroup } from '../../../../components/ui';
import { PRESET_LABELS, type EmailFormValues } from './emailForm';

const PRESETS = [SMTPPreset.GMAIL, SMTPPreset.OUTLOOK, SMTPPreset.CUSTOM];

/**
 * Which mail service sends the alerts. Gmail and Outlook bring their own server settings;
 * "Other mail server" shows the server fields, starting from the server last used.
 */
export function SmtpPresetFields() {
  const { control } = useFormContext<EmailFormValues>();
  return (
    <Controller
      control={control}
      name="preset"
      render={({ field }) => (
        <RadioGroup
          legend="Mail service"
          orientation="horizontal"
          value={field.value}
          onValueChange={(next) => field.onChange(next as SMTPPreset)}
        >
          {PRESETS.map((preset) => (
            <Radio key={preset} value={preset} label={PRESET_LABELS[preset]} />
          ))}
        </RadioGroup>
      )}
    />
  );
}

export default SmtpPresetFields;
