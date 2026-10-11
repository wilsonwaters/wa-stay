import { useEffect, useState } from 'react';

const query = (px: number) => `(min-width: ${px}px)`;

function matches(px: number): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query(px)).matches
    : false;
}

/** True while the window is at least `px` wide. False where `matchMedia` is missing. */
export function useMinWidth(px: number): boolean {
  const [wide, setWide] = useState(() => matches(px));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query(px));
    const update = () => setWide(list.matches);
    update();
    list.addEventListener?.('change', update);
    return () => list.removeEventListener?.('change', update);
  }, [px]);
  return wide;
}
