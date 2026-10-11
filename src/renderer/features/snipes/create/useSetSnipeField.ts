import { useCallback } from 'react';
import { useFormContext, type FieldPath, type PathValue } from 'react-hook-form';
import type { SnipeFormValues } from './snipeForm';

type Name = FieldPath<SnipeFormValues>;
type Entry = { [N in Name]: [N, PathValue<SnipeFormValues, N>] }[Name];

/**
 * Sets snipe form values from a controlled field (dates, guests, location…), marking them
 * changed, then re-checks them together if any is showing an error (as the watch form does).
 */
export function useSetSnipeFields() {
  const { setValue, getFieldState, trigger } = useFormContext<SnipeFormValues>();
  return useCallback(
    (...entries: Entry[]) => {
      const showing = entries.some(([name]) => getFieldState(name).error);
      for (const [name, value] of entries) setValue(name, value, { shouldDirty: true });
      if (showing) void trigger(entries.map(([name]) => name));
    },
    [setValue, getFieldState, trigger]
  );
}

/** One value at a time: `set('location', next)`. */
export function useSetSnipeField() {
  const setFields = useSetSnipeFields();
  return useCallback(
    <N extends Name>(name: N, value: PathValue<SnipeFormValues, N>) =>
      setFields([name, value] as Entry),
    [setFields]
  );
}
