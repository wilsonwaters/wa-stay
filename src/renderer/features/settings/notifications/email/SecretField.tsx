import { useEffect, useRef } from 'react';
import { KeyRound } from 'lucide-react';
import { useFormContext } from 'react-hook-form';
import { Button, Field, TextField, VisuallyHidden } from '../../../../components/ui';
import type { EmailFormValues } from './emailForm';

export interface SecretFieldProps {
  /** `saved`: a password is stored and will be kept; `entry`: one is typed here. */
  mode: 'saved' | 'entry';
  /** Entry was chosen with Replace, so Cancel can go back to the saved one. */
  replacing: boolean;
  onReplace(): void;
  onCancel(): void;
  label: string;
  /** Why a password is needed again, when one is stored but can't be kept. */
  reason?: string;
  /** The vault keeps its key in the data folder (no OS key store): said honestly. */
  localKey?: boolean;
}

/**
 * The SMTP password, write-only (P5): a stored password is never shown or sent back, only
 * "Password saved" with Replace. Replace moves focus into the new field; Cancel restores
 * "Password saved" and returns focus to Replace.
 */
export function SecretField({
  mode,
  replacing,
  onReplace,
  onCancel,
  label,
  reason,
  localKey,
}: SecretFieldProps) {
  const {
    register,
    setValue,
    formState: { errors },
  } = useFormContext<EmailFormValues>();
  const replaceRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const shown = useRef(mode);
  const { ref: registerRef, ...field } = register('password');

  // Focus follows the switch between the two modes, never on first render
  useEffect(() => {
    if (shown.current === mode) return;
    shown.current = mode;
    if (mode === 'entry' && replacing) inputRef.current?.focus();
    if (mode === 'saved') replaceRef.current?.focus();
  }, [mode, replacing]);

  const storage = (
    <>
      Stored encrypted on this device and sent only to your mail server.
      {localKey &&
        " This computer has no system key store, so the key is kept in WA Stay's data folder."}
    </>
  );

  if (mode === 'saved') {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-semibold text-fg">{label}</p>
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex items-center gap-1.5 text-sm text-fg-secondary">
            <KeyRound size={16} aria-hidden="true" />
            Password saved
          </p>
          <Button ref={replaceRef} variant="secondary" size="sm" onClick={onReplace}>
            Replace
          </Button>
        </div>
        <p className="text-sm text-fg-muted">{storage}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Field
        label={replacing ? `New ${label.toLowerCase()}` : label}
        hint={
          <>
            {reason && <>{reason} </>}
            {storage}
          </>
        }
        error={errors.password?.message}
      >
        <TextField
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          {...field}
          ref={(element) => {
            registerRef(element);
            inputRef.current = element;
          }}
        />
      </Field>
      {replacing && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setValue('password', '');
              onCancel();
            }}
          >
            Cancel
            <VisuallyHidden> replacing the password</VisuallyHidden>
          </Button>
        </div>
      )}
    </div>
  );
}

export default SecretField;
