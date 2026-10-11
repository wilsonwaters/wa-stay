/**
 * A provider's own stay fields (architecture-notes §12.1, §12.18), for any create or edit
 * form: which fields apply to a use, their starting values, their checks (the same rules and
 * words main applies, from `shared/utils/stay-fields`), and the `stayParams` they become. Pure;
 * no provider is named here.
 */
import type {
  ProviderManifest,
  StayFieldDescriptor,
  StayFieldUse,
  StayParams,
} from '../../../shared/types/provider.types';
import { stayFieldProblem } from '../../../shared/utils/stay-fields';

/** A form's value for one field: empty text and unset numbers are `''` / `undefined`. */
export type StayFieldValue = string | number | boolean | undefined;
export type StayFieldValues = Record<string, StayFieldValue>;

/** The provider's fields that apply to any of `uses`, leaving out those in `except`. */
export function stayFieldsFor(
  manifest: Pick<ProviderManifest, 'stayFields'> | undefined,
  uses: readonly StayFieldUse[],
  except: readonly StayFieldDescriptor[] = []
): StayFieldDescriptor[] {
  const skip = new Set(except.map((field) => field.key));
  return (manifest?.stayFields ?? []).filter(
    (field) => !skip.has(field.key) && field.appliesTo.some((use) => uses.includes(use))
  );
}

/** A field's starting value: its default, else empty (a number starts at its minimum). */
export function stayFieldDefault(field: StayFieldDescriptor): StayFieldValue {
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case 'boolean':
      return false;
    case 'number':
      return field.min ?? 0;
    case 'select':
      return field.options?.[0]?.value ?? '';
    default:
      return '';
  }
}

export function stayFieldDefaults(fields: readonly StayFieldDescriptor[]): StayFieldValues {
  return Object.fromEntries(fields.map((field) => [field.key, stayFieldDefault(field)]));
}

const isEmpty = (value: unknown) =>
  value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value));

/** What is wrong with a form value, or undefined. Empty is fine unless the field is required. */
export function stayFieldIssue(field: StayFieldDescriptor, value: unknown): string | undefined {
  if (isEmpty(value)) return field.required ? `${field.label} is required` : undefined;
  return stayFieldProblem(field, value);
}

/** The form values as `stayParams`: only the given fields, and nothing empty. */
export function toStayParams(
  fields: readonly StayFieldDescriptor[],
  values: StayFieldValues
): StayParams {
  const params: StayParams = {};
  for (const field of fields) {
    const value = values[field.key];
    if (!isEmpty(value) && value !== undefined) params[field.key] = value;
  }
  return params;
}

/**
 * A stored value as the form can show it, with a note when it had to change. A select value
 * that is not one of the options (an old watch's `tent,caravan`) becomes the one listed option
 * it names, if exactly one, else the field's default; the note says what it was.
 */
export function storedStayFieldValue(
  field: StayFieldDescriptor,
  stored: StayParams[string] | undefined
): { value: StayFieldValue; note?: string } {
  if (stored === undefined) return { value: stayFieldDefault(field) };
  if (field.type !== 'select' || !field.options) return { value: stored };
  const options = field.options;
  if (options.some((option) => option.value === stored)) return { value: stored };
  const named = String(stored)
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .map((part) => options.find((option) => option.value.toLowerCase() === part))
    .filter((option): option is NonNullable<typeof option> => Boolean(option));
  const unique = [...new Set(named)];
  const chosen = unique.length === 1 ? unique[0] : undefined;
  const value = chosen?.value ?? stayFieldDefault(field);
  const label = options.find((option) => option.value === value)?.label ?? String(value);
  const was = String(stored)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => options.find((o) => o.value === part.toLowerCase())?.label ?? part)
    .join(', ');
  return {
    value,
    note: `${field.label} was saved as "${was}", which can't be checked any more, so it is now ${label}.`,
  };
}
