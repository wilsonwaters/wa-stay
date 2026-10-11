import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type FocusEvent,
  type ReactNode,
} from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { cx } from './cx';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Milliseconds before it closes itself. `Infinity` keeps it until dismissed. */
  duration?: number;
}

export interface ToastRecord {
  id: string;
  tone: ToastTone;
  message: string;
  action?: ToastAction;
  duration: number;
}

/** Errors stay until dismissed: people need time to read what went wrong. */
export const TOAST_DURATION_MS: Record<ToastTone, number> = {
  success: 5000,
  info: 5000,
  warning: 8000,
  error: Infinity,
};
export const MAX_VISIBLE_TOASTS = 3;
/** The same message fired again within this window returns the first toast's id. */
export const TOAST_DEDUPE_MS = 1000;

interface Timer {
  remaining: number;
  startedAt: number;
  handle?: ReturnType<typeof setTimeout>;
  paused: boolean;
  suspended?: boolean;
}

/**
 * Toast state lives outside React so a toast's timer starts once, when the toast first
 * becomes visible, and is never reset by a re-render (the old Toast.tsx:48 bug).
 */
export class ToastStore {
  private toasts: ToastRecord[] = [];
  private timers = new Map<string, Timer>();
  private recent = new Map<string, { id: string; at: number }>();
  private listeners = new Set<() => void>();
  private seq = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.toasts;

  add(tone: ToastTone, message: string, options: ToastOptions = {}): string {
    const key = `${tone}|${message}`;
    const now = Date.now();
    // Forget messages older than the dedupe window, so the map holds only the last second.
    for (const [k, entry] of this.recent)
      if (now - entry.at >= TOAST_DEDUPE_MS) this.recent.delete(k);
    const recent = this.recent.get(key);
    if (recent && now - recent.at < TOAST_DEDUPE_MS && this.has(recent.id)) return recent.id;

    const id = `toast-${++this.seq}`;
    this.recent.set(key, { id, at: now });
    this.toasts = [
      ...this.toasts,
      {
        id,
        tone,
        message,
        action: options.action,
        duration: options.duration ?? TOAST_DURATION_MS[tone],
      },
    ];
    this.commit();
    return id;
  }

  dismiss = (id: string) => {
    if (!this.has(id)) return;
    const timer = this.timers.get(id);
    if (timer?.handle) clearTimeout(timer.handle);
    this.timers.delete(id);
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.commit();
  };

  pause = (id: string) => {
    const timer = this.timers.get(id);
    if (!timer || timer.paused) return;
    timer.paused = true;
    if (timer.handle) clearTimeout(timer.handle);
    timer.handle = undefined;
    timer.remaining -= Date.now() - timer.startedAt;
  };

  resume = (id: string) => {
    const timer = this.timers.get(id);
    if (!timer || !timer.paused) return;
    timer.paused = false;
    this.run(id, timer);
  };

  /** Stops every running timer (provider unmounted), keeping what is left of each. */
  suspend() {
    for (const [id, timer] of this.timers) {
      if (timer.paused) continue;
      this.pause(id);
      timer.suspended = true;
    }
  }

  /** Restarts the timers `suspend` stopped (provider mounted again, e.g. StrictMode). */
  wake() {
    for (const [id, timer] of this.timers) {
      if (!timer.suspended) continue;
      timer.suspended = false;
      this.resume(id);
    }
  }

  private has(id: string) {
    return this.toasts.some((t) => t.id === id);
  }

  /** Starts the timer of any toast that has just become visible, then notifies. */
  private commit() {
    for (const toast of this.toasts.slice(0, MAX_VISIBLE_TOASTS)) {
      if (this.timers.has(toast.id) || !Number.isFinite(toast.duration)) continue;
      const timer: Timer = { remaining: toast.duration, startedAt: 0, paused: false };
      this.timers.set(toast.id, timer);
      this.run(toast.id, timer);
    }
    this.listeners.forEach((listener) => listener());
  }

  private run(id: string, timer: Timer) {
    timer.startedAt = Date.now();
    timer.handle = setTimeout(() => this.dismiss(id), Math.max(0, timer.remaining));
  }
}

export interface ToastApi {
  success: (message: string, options?: ToastOptions) => string;
  info: (message: string, options?: ToastOptions) => string;
  warning: (message: string, options?: ToastOptions) => string;
  error: (message: string, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<{ store: ToastStore; api: ToastApi } | null>(null);

function useToastContext() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast and ToastViewport must be used inside <ToastProvider>');
  return context;
}

/** Holds the app's toasts. Place one `ToastViewport` somewhere inside it. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<ToastStore>(undefined);
  if (!storeRef.current) storeRef.current = new ToastStore();
  const store = storeRef.current;

  useEffect(() => {
    store.wake();
    return () => store.suspend();
  }, [store]);

  const value = useMemo(() => {
    const api: ToastApi = {
      success: (message, options) => store.add('success', message, options),
      info: (message, options) => store.add('info', message, options),
      warning: (message, options) => store.add('warning', message, options),
      error: (message, options) => store.add('error', message, options),
      dismiss: store.dismiss,
    };
    return { store, api };
  }, [store]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/**
 * `const toast = useToast(); toast.success('Watch saved')`. Returns the toast's id; the
 * functions are stable across renders.
 */
export function useToast(): ToastApi {
  return useToastContext().api;
}

const TONE: Record<ToastTone, { icon: LucideIcon; className: string }> = {
  success: { icon: CircleCheck, className: 'text-available' },
  info: { icon: Info, className: 'text-brand' },
  warning: { icon: TriangleAlert, className: 'text-warning-fg' },
  error: { icon: CircleAlert, className: 'text-danger' },
};

function ToastItem({ toast, store }: { toast: ToastRecord; store: ToastStore }) {
  const hovered = useRef(false);
  const focused = useRef(false);
  const sync = () =>
    hovered.current || focused.current ? store.pause(toast.id) : store.resume(toast.id);
  const { icon: Icon, className } = TONE[toast.tone];

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onPointerEnter={() => {
        hovered.current = true;
        sync();
      }}
      onPointerLeave={() => {
        hovered.current = false;
        sync();
      }}
      onFocus={() => {
        focused.current = true;
        sync();
      }}
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        focused.current = false;
        sync();
      }}
      className="pointer-events-auto flex animate-fade-in items-start gap-3 rounded-lg border border-border bg-surface py-3 pl-4 pr-2 text-fg shadow-pop"
    >
      <Icon size={20} className={cx('mt-0.5 shrink-0', className)} aria-hidden="true" />
      <p className="min-w-0 flex-1 py-0.5 text-sm">{toast.message}</p>
      {toast.action && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            toast.action?.onClick();
            store.dismiss(toast.id);
          }}
        >
          {toast.action.label}
        </Button>
      )}
      <IconButton
        label="Dismiss notification"
        icon={<X size={16} />}
        size="sm"
        onClick={() => store.dismiss(toast.id)}
      />
    </div>
  );
}

/**
 * Renders the visible toasts (at most three, oldest first; the rest wait their turn) in a
 * "Notifications" region. The list inside is a polite live region that is always rendered, so
 * it exists before the first toast arrives and screen readers announce each one; errors are
 * also `role="alert"`.
 *
 * It renders where it is placed and takes its container's width: the app positions and sizes
 * it (the tray's column). Place it outside `#root` (in a `Portal`): a modal makes `#root` inert,
 * which would silence the toasts and block clicks.
 */
export function ToastViewport({ className }: { className?: string }) {
  const { store } = useToastContext();
  const toasts = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return (
    <div role="region" aria-label="Notifications" className={cx('w-full', className)}>
      <ol aria-live="polite" aria-relevant="additions text" className="flex flex-col gap-2">
        {toasts.slice(0, MAX_VISIBLE_TOASTS).map((toast) => (
          <li key={toast.id}>
            <ToastItem toast={toast} store={store} />
          </li>
        ))}
      </ol>
    </div>
  );
}
