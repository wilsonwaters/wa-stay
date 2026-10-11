import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

/**
 * `/settings/accounts?provider=<id>` (Watches, Site Sniper and Bookings link here): once the
 * rows have rendered, scrolls that provider's row into view and focuses it (`focusRow`). Once
 * per arrival: a later re-render, or an account update, leaves focus where the person put it.
 * An unknown id does nothing.
 */
export function useProviderDeepLink(ready: boolean, focusRow: (providerId: string) => boolean) {
  const { search, key } = useLocation();
  const handled = useRef<string | null>(null);
  const latest = useRef(focusRow);
  latest.current = focusRow;

  useEffect(() => {
    const providerId = new URLSearchParams(search).get('provider');
    if (!ready || !providerId || handled.current === key) return;
    handled.current = key;
    latest.current(providerId);
  }, [ready, search, key]);
}

/** Brings a row into view without animating (reduced motion or not, it is a jump to a target). */
export function scrollRowIntoView(row: Element | null): void {
  row?.scrollIntoView?.({ block: 'center' });
}
