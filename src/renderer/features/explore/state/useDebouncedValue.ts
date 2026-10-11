import { useEffect, useState } from 'react';

/**
 * `value`, once it has stayed the same for `delayMs`. The first value is returned at once; a
 * change restarts the wait, so a quick run of changes gives only the last one.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return undefined;
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, settled, delayMs]);
  return settled;
}
