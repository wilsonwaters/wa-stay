import { useEffect, useState } from 'react';

/**
 * True once `active` has stayed true for `ms`: the quick refetch that follows each pushed
 * update (already applied in place) never flashes "Updating…".
 */
export function useLingering(active: boolean, ms = 1000): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return undefined;
    }
    const timer = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return shown;
}
