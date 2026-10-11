import { useFormContext } from 'react-hook-form';
import { Field, TextField } from '../../../../components/ui';
import type { EmailFormValues } from './emailForm';

/** Where alerts go. Empty sends them to the sending account. */
export function RecipientField() {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<EmailFormValues>();
  const user = watch('user').trim();
  return (
    <Field
      label="Send alerts to"
      optional
      hint={user ? `Leave empty to send to ${user}` : 'Leave empty to send to the account above'}
      error={errors.toEmail?.message}
    >
      <TextField type="email" autoComplete="email" {...register('toEmail')} />
    </Field>
  );
}

export default RecipientField;
