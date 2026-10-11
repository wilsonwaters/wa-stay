import { useEffect, useRef, useState } from 'react';

const NONE: ReadonlySet<string> = new Set();

/**
 * Which of `loading` (ids of things loading now, such as `stayKey|providerId`) have been
 * loading for at least `afterMs`. An id's clock starts when it first appears and stops when it
 * leaves the list; one that comes back starts again.
 */
export function useSlowLoads(loading: readonly string[], afterMs: number): ReadonlySet<string> {
  const since = useRef(new Map<string, number>());
  const [slow, setSlow] = useState<ReadonlySet<string>>(NONE);
  const signature = [...loading].sort().join('\n');

  useEffect(() => {
    const now = Date.now();
    const current = new Set(signature ? signature.split('\n') : []);
    for (const id of [...since.current.keys()]) {
      if (!current.has(id)) since.current.delete(id);
    }
    for (const id of current) if (!since.current.has(id)) since.current.set(id, now);
    setSlow((previous) => {
      const kept = [...previous].filter((id) => current.has(id));
      return kept.length === previous.size ? previous : new Set(kept);
    });

    const timers = [...current].map((id) => {
      const wait = Math.max(0, (since.current.get(id) ?? now) + afterMs - now);
      return setTimeout(() => {
        setSlow((previous) => (previous.has(id) ? previous : new Set([...previous, id])));
      }, wait);
    });
    return () => timers.forEach(clearTimeout);
  }, [signature, afterMs]);

  return slow;
}
