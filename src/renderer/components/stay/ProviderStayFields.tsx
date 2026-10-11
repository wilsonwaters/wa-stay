import { CircleAlert } from 'lucide-react';
import type { StayFieldDescriptor } from '../../../shared/types/provider.types';
import { Checkbox, Field, Select, Stepper, TextField } from '../ui';
import type { StayFieldValue, StayFieldValues } from './stayFields';

export interface ProviderStayFieldsProps {
  /** The provider's fields to show (`stayFieldsFor(manifest, uses)`). */
  fields: readonly StayFieldDescriptor[];
  values: StayFieldValues;
  onChange: (key: string, value: StayFieldValue) => void;
  /** Validation messages by field key. */
  errors?: Partial<Record<string, string>>;
  /** Extra lines by field key, e.g. why an old value changed. */
  notes?: Partial<Record<string, string>>;
}

/**
 * A provider's own stay inputs, drawn from its declared fields (architecture-notes §12.1):
 * select → Select, number → Stepper, text → TextField, yes/no → Checkbox. No provider code:
 * the manifest says what to ask.
 */
export function ProviderStayFields({
  fields,
  values,
  onChange,
  errors = {},
  notes = {},
}: ProviderStayFieldsProps) {
  return (
    <>
      {fields.map((field) => {
        const value = values[field.key];
        const hint = [field.help, notes[field.key]].filter(Boolean).join(' ') || undefined;
        const error = errors[field.key];
        switch (field.type) {
          case 'select':
            return (
              <Field key={field.key} label={field.label} hint={hint} error={error}>
                <Select
                  name={`stayParams.${field.key}`}
                  value={typeof value === 'string' ? value : ''}
                  onChange={(event) => onChange(field.key, event.target.value)}
                >
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
            );
          case 'number':
            return (
              <Stepper
                key={field.key}
                label={field.label}
                hint={hint}
                error={error}
                value={typeof value === 'number' ? value : (field.min ?? 0)}
                min={field.min}
                max={field.max}
                onChange={(next) => onChange(field.key, next)}
              />
            );
          case 'boolean':
            return (
              <div key={field.key} className="flex flex-col gap-1.5">
                <Checkbox
                  name={`stayParams.${field.key}`}
                  label={field.label}
                  description={hint}
                  checked={value === true}
                  onChange={(event) => onChange(field.key, event.target.checked)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `stay-field-${field.key}-error` : undefined}
                />
                {error && (
                  <p
                    id={`stay-field-${field.key}-error`}
                    className="flex items-start gap-1.5 text-sm font-medium text-danger"
                  >
                    <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                  </p>
                )}
              </div>
            );
          default:
            return (
              <Field
                key={field.key}
                label={field.label}
                hint={hint}
                error={error}
                optional={!field.required}
              >
                <TextField
                  name={`stayParams.${field.key}`}
                  value={typeof value === 'string' ? value : ''}
                  onChange={(event) => onChange(field.key, event.target.value)}
                />
              </Field>
            );
        }
      })}
    </>
  );
}

export default ProviderStayFields;
