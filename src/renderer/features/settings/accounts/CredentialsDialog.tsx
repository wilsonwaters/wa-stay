import { useId, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../../api';
import type { ProviderAccount, ProviderManifest } from '../../../../shared/types/provider.types';
import { Button, Checkbox, Dialog, Field, Notice, TextField } from '../../../components/ui';
import { CREDENTIALS_TEXT, credentialFieldError, credentialsDialogTitle } from './accountText';

export interface CredentialsDialogProps {
  manifest: ProviderManifest;
  /** The `credentials` account: its fields and confirmations (never a value). */
  account: ProviderAccount;
  /** A save is in flight: Save shows it and the dialog can't be dismissed. */
  pending: boolean;
  /** Sends the values to main; resolves with the saved account, rejects with main's refusal. */
  onSave(values: Record<string, string>, confirmed: string[]): Promise<ProviderAccount>;
  /** After a save: the parent unmounts the dialog, so the typed values leave memory. */
  onSaved(account: ProviderAccount): void;
  /** Cancel, Escape, the scrim or the close button. */
  onClose(): void;
}

/** A refusal's message on its field when main names exactly one of them, else in a notice. */
function placeRefusal(error: unknown, fieldKeys: string[]) {
  const message =
    error instanceof Error && error.message ? error.message : CREDENTIALS_TEXT.saveFailed;
  const issues = error instanceof ApiError ? (error.issues ?? []) : [];
  const named = issues
    .filter((issue) => issue.startsWith('values.'))
    .map((issue) => issue.slice('values.'.length))
    .filter((key) => fieldKeys.includes(key));
  return named.length === 1 ? { field: named[0], message } : { message };
}

/**
 * Add or Replace a `credentials` account's details (Settings → Accounts), titled "{shortName}
 * account": one field per descriptor (its label and help; secret ones masked), the provider's
 * statements as checkboxes, and Save, disabled until every statement is ticked. Mount it to
 * open it and unmount it to close it: the typed values live only in its state, so they go
 * when it does. Focus starts on the first field and returns to the opener on Cancel or Escape.
 */
export function CredentialsDialog({
  manifest,
  account,
  pending,
  onSave,
  onSaved,
  onClose,
}: CredentialsDialogProps) {
  const fields = account.fields ?? [];
  const confirmations = account.confirmations ?? [];
  const formId = useId();
  const hintId = useId();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, '']))
  );
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());

  const allTicked = confirmations.every((confirmation) => ticked.has(confirmation.key));
  const focusField = (key: string) => inputs.current.get(key)?.focus();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!allTicked || pending) return;
    const found: Record<string, string> = {};
    for (const field of fields) {
      const error = credentialFieldError(field, values[field.key] ?? '');
      if (error) found[field.key] = error;
    }
    setErrors(found);
    setNotice(null);
    const firstInvalid = fields.find((field) => found[field.key]);
    if (firstInvalid) {
      focusField(firstInvalid.key);
      return;
    }
    try {
      onSaved(await onSave({ ...values }, [...ticked]));
    } catch (error) {
      const refusal = placeRefusal(
        error,
        fields.map((field) => field.key)
      );
      if (refusal.field) {
        setErrors({ [refusal.field]: refusal.message });
        focusField(refusal.field);
      } else setNotice(refusal.message);
    }
  };

  const toggle = (key: string, checked: boolean) =>
    setTicked((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <Dialog
      open
      onClose={onClose}
      title={credentialsDialogTitle(manifest)}
      description={CREDENTIALS_TEXT.storage}
      closeOnEsc={!pending}
      closeOnOverlayClick={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {CREDENTIALS_TEXT.cancel}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={!allTicked}
            loading={pending}
            aria-describedby={allTicked ? undefined : hintId}
          >
            {CREDENTIALS_TEXT.save}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-5">
        {notice && <Notice tone="danger">{notice}</Notice>}
        {fields.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            hint={field.help}
            required
            // role="alert": announced as it appears; Field links it to the input
            error={errors[field.key] && <span role="alert">{errors[field.key]}</span>}
          >
            <TextField
              ref={(element) => {
                if (element) inputs.current.set(field.key, element);
                else inputs.current.delete(field.key);
              }}
              type={field.secret ? 'password' : 'text'}
              autoComplete="off"
              spellCheck={false}
              value={values[field.key] ?? ''}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value }))
              }
            />
          </Field>
        ))}
        {confirmations.length > 0 && (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-sm font-semibold text-fg">
              {CREDENTIALS_TEXT.statements}
            </legend>
            {confirmations.map((confirmation) => (
              <Checkbox
                key={confirmation.key}
                label={confirmation.label}
                checked={ticked.has(confirmation.key)}
                onChange={(event) => toggle(confirmation.key, event.target.checked)}
              />
            ))}
          </fieldset>
        )}
        {!allTicked && (
          <p id={hintId} className="text-sm text-fg-muted">
            {CREDENTIALS_TEXT.tickEach}
          </p>
        )}
      </form>
    </Dialog>
  );
}

export default CredentialsDialog;
