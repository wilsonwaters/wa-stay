import { useCallback, useSyncExternalStore } from 'react';

/**
 * One shared clock per interval: every component that asks for `useNow(60_000)` re-renders
 * together once a minute from a single timer, which stops when the last one unmounts. U1 uses
 * a minute for "12 min ago"; Site Sniper's countdowns use a second.
 *
 * While the window is hidden (`document.hidden`) no timer runs at all; when it is shown again
 * every listener gets the current time at once, then the timer resumes.
 */
interface Ticker {
  now: number;
  intervalMs: number;
  listeners: Set<() => void>;
  timer?: ReturnType<typeof setInterval>;
}

const tickers = new Map<number, Ticker>();

const isHidden = () => typeof document !== 'undefined' && document.hidden;

function tickerFor(intervalMs: number): Ticker {
  let ticker = tickers.get(intervalMs);
  if (!ticker) {
    ticker = { now: Date.now(), intervalMs, listeners: new Set() };
    tickers.set(intervalMs, ticker);
  }
  return ticker;
}

function tick(ticker: Ticker): void {
  ticker.now = Date.now();
  ticker.listeners.forEach((notify) => notify());
}

function start(ticker: Ticker): void {
  if (ticker.timer || isHidden() || ticker.listeners.size === 0) return;
  ticker.timer = setInterval(() => tick(ticker), ticker.intervalMs);
}

function stop(ticker: Ticker): void {
  clearInterval(ticker.timer);
  ticker.timer = undefined;
}

/** Hidden: every ticker stops. Shown: each ticker with listeners catches up, then restarts. */
function onVisibilityChange(): void {
  for (const ticker of tickers.values()) {
    if (isHidden()) {
      stop(ticker);
    } else if (ticker.listeners.size > 0 && !ticker.timer) {
      tick(ticker);
      start(ticker);
    }
  }
}

let watchingVisibility = false;

function watchVisibility(): void {
  if (watchingVisibility || typeof document === 'undefined') return;
  watchingVisibility = true;
  document.addEventListener('visibilitychange', onVisibilityChange);
}

function subscribe(intervalMs: number, listener: () => void): () => void {
  const ticker = tickerFor(intervalMs);
  watchVisibility();
  if (ticker.listeners.size === 0) ticker.now = Date.now();
  ticker.listeners.add(listener);
  start(ticker);
  return () => {
    ticker.listeners.delete(listener);
    if (ticker.listeners.size === 0) stop(ticker);
  };
}

/** The current time, updated every `intervalMs` (default one minute) while the window shows. */
export function useNow(intervalMs = 60_000): Date {
  const subscribeToTicker = useCallback(
    (listener: () => void) => subscribe(intervalMs, listener),
    [intervalMs]
  );
  const now = useSyncExternalStore(subscribeToTicker, () => tickerFor(intervalMs).now);
  return new Date(now);
}

/**
 * Whether `at` has passed, from the same shared ticker: the component re-renders only when the
 * answer changes (an expiry, a release), never on every tick. Undefined `at` never passes.
 */
export function useHasPassed(at: Date | number | undefined, intervalMs = 1000): boolean {
  const target = at === undefined ? undefined : new Date(at).getTime();
  const subscribeToTicker = useCallback(
    (listener: () => void) =>
      target === undefined ? () => undefined : subscribe(intervalMs, listener),
    [intervalMs, target]
  );
  return useSyncExternalStore(subscribeToTicker, () => {
    if (target === undefined) return false;
    const ticker = tickerFor(intervalMs);
    // A ticker nobody listens to holds a stale time: until subscribed, ask the clock.
    return (ticker.listeners.size > 0 ? ticker.now : Date.now()) >= target;
  });
}
