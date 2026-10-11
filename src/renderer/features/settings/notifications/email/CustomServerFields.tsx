import { useFormContext } from 'react-hook-form';
import { Field, Select, TextField } from '../../../../components/ui';
import { securityHint, type EmailFormValues } from './emailForm';

/** The server settings for a mail service other than Gmail or Outlook. */
export function CustomServerFields() {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<EmailFormValues>();
  const hint = securityHint(watch('port'), watch('security'));

  return (
    <div className="flex flex-col gap-4">
      <Field label="Mail server" hint="Such as smtp.example.com" error={errors.host?.message}>
        <TextField autoComplete="off" spellCheck={false} {...register('host')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <Field label="Port" error={errors.port?.message}>
          <TextField inputMode="numeric" autoComplete="off" {...register('port')} />
        </Field>
        <Field label="Security" hint={hint}>
          <Select {...register('security')}>
            <option value="tls">SSL/TLS</option>
            <option value="starttls">STARTTLS</option>
          </Select>
        </Field>
      </div>
      <Field
        label="From address"
        optional
        hint="Leave empty to send from the account above"
        error={errors.fromEmail?.message}
      >
        <TextField type="email" autoComplete="off" {...register('fromEmail')} />
      </Field>
    </div>
  );
}

export default CustomServerFields;
