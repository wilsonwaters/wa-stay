import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router';

/**
 * Explore's list position, kept for this window's session so Back from a place's detail page
 * lands where the person left the list: the page's scroll and how many cards were on it,
 * under `sessionStorage['ws:explore:scroll:' + search]`.
 */
export const SCROLL_KEY_PREFIX = 'ws:explore:scroll:';

export interface ScrollMemory {
  /** The window's `scrollY`. */
  y: number;
  /** Cards on the page ("Show more places" adds 40 at a time). */
  shown: number;
}

export function readScrollMemory(search: string): ScrollMemory | null {
  try {
    const raw = window.sessionStorage.getItem(SCROLL_KEY_PREFIX + search);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ScrollMemory>;
    const y = Number(value.y);
    const shown = Number(value.shown);
    if (!Number.isFinite(y) || y < 0 || !Number.isInteger(shown) || shown < 0) return null;
    return { y, shown };
  } catch {
    return null;
  }
}

export function writeScrollMemory(search: string, memory: ScrollMemory): void {
  try {
    window.sessionStorage.setItem(SCROLL_KEY_PREFIX + search, JSON.stringify(memory));
  } catch {
    // Storage can be full or blocked; the list then opens at the top, as it would anyway.
  }
}

function scrollWindowTo(y: number): void {
  if (Math.abs(window.scrollY - y) < 1) return;
  window.scrollTo(0, y);
}

export interface ExploreScrollMemory {
  /** Cards to start the list with: what was on the page when Back returns to it. */
  initialShown: number | undefined;
  /** Tell it how many cards are on the page. */
  setShown: (shown: number) => void;
}

/**
 * Remembers Explore's scroll position and card count per search while the page is open, and
 * puts them back when Explore is returned to with Back (a `POP`), once `ready` (its results
 * are on the page). Any other visit starts at the top.
 */
export function useExploreScrollMemory(ready: boolean): ExploreScrollMemory {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [saved] = useState(() =>
    navigationType === 'POP' ? readScrollMemory(location.search) : null
  );
  const search = useRef(location.search);
  search.current = location.search;
  const shown = useRef(saved?.shown ?? 0);

  const save = useCallback(() => {
    writeScrollMemory(search.current, { y: window.scrollY, shown: shown.current });
  }, []);

  // A new visit starts at the top; a return waits for its results, then goes back.
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current) return;
    if (!saved) {
      restored.current = true;
      scrollWindowTo(0);
      return;
    }
    if (!ready) return;
    restored.current = true;
    scrollWindowTo(saved.y);
  }, [ready, saved]);

  // Save while scrolling (at most once a frame) and on leaving.
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame || !restored.current) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        save();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [save]);
  useLayoutEffect(
    () => () => {
      if (restored.current) save();
    },
    [save]
  );

  const setShown = useCallback(
    (count: number) => {
      shown.current = count;
      if (restored.current) save();
    },
    [save]
  );

  return { initialShown: saved?.shown, setShown };
}
