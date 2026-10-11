import { useEffect, useLayoutEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { EventName, EventPayloads } from '../../shared/contracts';
import { getApi, isApiAvailable } from './client';

/**
 * Subscribes to a main-process event for as long as the component is mounted. The subscription
 * is made once per event name; the latest `callback` is always the one called, so passing an
 * inline function does not resubscribe. Outside the app (no `window.api`) it does nothing.
 */
export function useApiEvent<E extends EventName>(
  name: E,
  callback: (payload: EventPayloads[E]) => void
): void {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });

  useEffect(() => {
    if (!isApiAvailable()) return undefined;
    return getApi().events.on(name, (payload) => latest.current(payload));
  }, [name]);
}

export interface InvalidateOnOptions {
  /**
   * Coalesces a burst: the first event starts a window of this many milliseconds, and one
   * invalidation runs when it ends, however many events arrived in it. Without it, every
   * event invalidates at once.
   */
  coalesceMs?: number;
}

/** Marks `queryKey` (and everything under it) stale whenever `event` arrives. */
export function useInvalidateOn(
  event: EventName,
  queryKey: QueryKey,
  { coalesceMs }: InvalidateOnOptions = {}
): void {
  const queryClient = useQueryClient();
  const latestKey = useRef(queryKey);
  latestKey.current = queryKey;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  useApiEvent(event, () => {
    const invalidate = () => {
      timer.current = undefined;
      void queryClient.invalidateQueries({ queryKey: latestKey.current });
    };
    if (!coalesceMs) {
      invalidate();
      return;
    }
    if (timer.current === undefined) timer.current = setTimeout(invalidate, coalesceMs);
  });
}
