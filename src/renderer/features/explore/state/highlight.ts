import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';

/**
 * The location being pointed at: a hovered or focused card, or a hovered pin. It lives outside
 * React state so a change re-renders only the two cards whose highlight changes (the one
 * leaving and the one arriving), never the whole list; the map listens directly.
 */
export interface HighlightStore {
  get(): string | null;
  set(key: string | null): void;
  subscribe(listener: () => void): () => void;
}

export function createHighlightStore(): HighlightStore {
  let current: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(key) {
      if (key === current) return;
      current = key;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const HighlightContext = createContext<HighlightStore | null>(null);

export function useHighlightStore(): HighlightStore {
  const store = useContext(HighlightContext);
  if (!store) throw new Error('useHighlightStore must be used inside <HighlightContext.Provider>');
  return store;
}

/** True while `key` is highlighted. Re-renders only when that answer changes. */
export function useIsHighlighted(key: string): boolean {
  const store = useHighlightStore();
  const isMine = useCallback(() => store.get() === key, [store, key]);
  return useSyncExternalStore(store.subscribe, isMine, isMine);
}
