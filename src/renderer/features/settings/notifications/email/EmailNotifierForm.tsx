import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SMTPPreset } from '../../../../../shared/types/notifier.types';
import { useAppInfo, useConfigureEmailNotifier, type EmailNotifierView } from '../../../../api';
import { Button, Field, Notice, TextField } from '../../../../components/ui';
import { CustomServerFields } from './CustomServerFields';
import {
  canKeepPassword,
  emailFormDefaults,
  emailFormSchema,
  serverOf,
  toConfigureInput,
  type EmailFormValues,
} from './emailForm';
import { RecipientField } from './RecipientField';
import { SecretField } from './SecretField';
import { SendTestButton } from './SendTestButton';
import { SetupInstructions } from './SetupInstructions';
import { SmtpPresetFields } from './SmtpPresetFields';

export interface EmailNotifierFormProps {
  notifier: EmailNotifierView | null;
  /** Closes the form; `saved` once the settings were stored. */
  onClose(saved: boolean): void;
  /**
   * Focus the first field when the form opens: it replaced the button that opened it, so focus
   * would otherwise fall to the page.
   */
  focusOnOpen?: boolean;
}

/** The form's first field: for a radio group, its checked radio (the group's one tab stop). */
function firstField(form: HTMLFormElement): HTMLElement | null {
  const first = form.querySelector<HTMLElement>('input, select, textarea');
  if (first instanceof HTMLInputElement && first.type === 'radio') {
    const group = [...form.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter(
      (radio) => radio.name === first.name
    );
    return group.find((radio) => radio.checked) ?? first;
  }
  return first;
}

/**
 * The email notifier's settings. A stored password is never shown: it is kept unless the
 * person replaces it, or changes the server or account it belongs to (then main needs a new
 * one, and so does this form).
 */
export function EmailNotifierForm({ notifier, onClose, focusOnOpen }: EmailNotifierFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const configure = useConfigureEmailNotifier();
  const info = useAppInfo();
  const [replacing, setReplacing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The password rule depends on the mode below, which follows the values: read at validation
  const passwordRequired = useRef(false);
  const resolver: Resolver<EmailFormValues> = (values, context, options) =>
    zodResolver(emailFormSchema({ passwordRequired: passwordRequired.current }))(
      values,
      context,
      options
    );
  const methods = useForm<EmailFormValues>({
    defaultValues: emailFormDefaults(notifier),
    resolver,
  });
  const { register, watch, formState, reset } = methods;
  const values = watch();

  const keep = canKeepPassword(notifier, values);
  const mode = keep && !replacing ? 'saved' : 'entry';
  passwordRequired.current = mode === 'entry';
  const reason =
    notifier?.secretState === 'unreadable'
      ? "The saved password couldn't be read on this computer. Enter it again."
      : notifier?.hasPassword && !keep
        ? 'Enter the password for this server and account.'
        : undefined;
  const custom = values.preset === SMTPPreset.CUSTOM;

  /** Stores the settings; true when saved. The typed password is dropped either way. */
  const store = async (formValues: EmailFormValues): Promise<boolean> => {
    setSaveError(null);
    try {
      await configure.mutateAsync(
        toConfigureInput(formValues, {
          sendPassword: mode === 'entry',
          enabled: notifier?.enabled ?? true,
        })
      );
      reset({ ...formValues, password: '' });
      setReplacing(false);
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      configure.reset();
    }
  };

  // Once, as it opens.
  const focusFirst = useRef(focusOnOpen);
  useEffect(() => {
    if (focusFirst.current && formRef.current) firstField(formRef.current)?.focus();
  }, []);

  const save = methods.handleSubmit(async (formValues) => {
    if (await store(formValues)) onClose(true);
  });

  /** "Save and send test": checks and stores the form first. */
  const saveForTest = () =>
    new Promise<boolean>((resolve) => {
      void methods.handleSubmit(
        async (formValues) => resolve(await store(formValues)),
        () => resolve(false)
      )();
    });

  return (
    <FormProvider {...methods}>
      <form
        ref={formRef}
        noValidate
        onSubmit={save}
        className="flex flex-col gap-5"
        aria-label="Email settings"
      >
        <SmtpPresetFields />
        {custom && <CustomServerFields />}
        <Field
          label={custom ? 'User name' : 'Email address'}
          hint={
            custom
              ? undefined
              : `The ${values.preset === SMTPPreset.GMAIL ? 'Gmail' : 'Outlook'} account that sends the alerts`
          }
          error={formState.errors.user?.message}
        >
          <TextField
            type={custom ? 'text' : 'email'}
            autoComplete="username"
            spellCheck={false}
            {...register('user')}
          />
        </Field>
        <SecretField
          mode={mode}
          replacing={replacing}
          onReplace={() => setReplacing(true)}
          onCancel={() => setReplacing(false)}
          label={custom ? 'Password' : 'App password'}
          reason={reason}
          localKey={info.data?.secretStorage?.backend === 'local'}
        />
        <RecipientField />
        <SetupInstructions preset={values.preset} />
        {saveError && (
          <Notice tone="danger" title="The settings weren't saved">
            {saveError}
          </Notice>
        )}
        <div className="flex flex-wrap items-start gap-3">
          <Button type="submit" variant="primary" loading={configure.isPending}>
            Save
          </Button>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Cancel
          </Button>
        </div>
        {notifier && (
          <SendTestButton
            save={formState.isDirty || mode === 'entry' ? saveForTest : undefined}
            recipient={values.toEmail.trim() || values.user.trim()}
            server={serverOf(values)}
          />
        )}
      </form>
    </FormProvider>
  );
}

export default EmailNotifierForm;
