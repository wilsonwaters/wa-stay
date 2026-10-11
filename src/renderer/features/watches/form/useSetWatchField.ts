import { useCallback } from 'react';
import { useFormContext, type FieldPath, type PathValue } from 'react-hook-form';
import type { WatchFormValues } from './watchFormSchema';

type Name = FieldPath<WatchFormValues>;
type Entry = { [N in Name]: [N, PathValue<WatchFormValues, N>] }[Name];

/**
 * Sets watch form values from a controlled field (dates, guests, location…), marking them
 * changed. Values that belong together (check-in and check-out) are written first and checked
 * after, together, when any of them is showing an error: checking one before the other is
 * written would keep an error the new values have fixed.
 */
export function useSetWatchFields() {
  const { setValue, getFieldState, trigger } = useFormContext<WatchFormValues>();
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
export function useSetWatchField() {
  const setFields = useSetWatchFields();
  return useCallback(
    <N extends Name>(name: N, value: PathValue<WatchFormValues, N>) =>
      setFields([name, value] as Entry),
    [setFields]
  );
}
