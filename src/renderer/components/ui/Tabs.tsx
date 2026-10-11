import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cx } from './cx';

interface TabsContextValue {
  /** The selected tab, or undefined until the first enabled tab is known. */
  value: string | undefined;
  select: (value: string) => void;
  /** Called by TabList with its first enabled tab, used when nothing is selected. */
  setFallback: (value: string | undefined) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(component: string): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) throw new Error(`${component} must be used inside <Tabs>`);
  return context;
}

const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_');
const tabId = (base: string, value: string) => `${base}-tab-${safe(value)}`;
const panelId = (base: string, value: string) => `${base}-panel-${safe(value)}`;

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

/**
 * Tabs with automatic activation: `tablist`/`tab`/`tabpanel`, a roving tabindex (only the
 * selected tab is in the tab order) and ←/→/Home/End. With no `value` or `defaultValue`, the
 * first enabled tab is selected.
 */
export function Tabs({ value, defaultValue, onValueChange, children, className }: TabsProps) {
  const baseId = useId();
  const [inner, setInner] = useState(defaultValue);
  const [fallback, setFallback] = useState<string>();
  const current = value ?? inner ?? fallback;
  const select = (next: string) => {
    if (value === undefined) setInner(next);
    onValueChange?.(next);
  };
  return (
    <TabsContext.Provider value={{ value: current, select, setFallback, baseId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabListProps {
  /** Names the tab list, e.g. "Location details". */
  'aria-label': string;
  children: ReactNode;
  className?: string;
}

const ENABLED_TABS = '[role="tab"]:not([disabled])';

export function TabList({ 'aria-label': label, children, className }: TabListProps) {
  const { select, setFallback } = useTabs('TabList');
  const listRef = useRef<HTMLDivElement>(null);

  // Before paint, so nothing renders with no tab selected (and none in the tab order).
  useLayoutEffect(() => {
    setFallback(listRef.current?.querySelector<HTMLElement>(ENABLED_TABS)?.dataset.value);
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(ENABLED_TABS));
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    const target =
      event.key === 'ArrowRight'
        ? tabs[(index + 1) % tabs.length]
        : event.key === 'ArrowLeft'
          ? tabs[(index - 1 + tabs.length) % tabs.length]
          : event.key === 'Home'
            ? tabs[0]
            : event.key === 'End'
              ? tabs[tabs.length - 1]
              : undefined;
    if (!target) return;
    event.preventDefault();
    target.focus();
    select(target.dataset.value ?? '');
  };
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx('flex gap-6 border-b border-border', className)}
    >
      {children}
    </div>
  );
}

export interface TabProps {
  value: string;
  children: ReactNode;
  disabled?: boolean;
}

export function Tab({ value, children, disabled }: TabProps) {
  const { value: current, select, baseId } = useTabs('Tab');
  const selected = current === value;
  return (
    <button
      type="button"
      role="tab"
      id={tabId(baseId, value)}
      data-value={value}
      aria-selected={selected}
      aria-controls={panelId(baseId, value)}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => select(value)}
      className={cx(
        '-mb-px inline-flex items-center gap-2 border-b-2 px-1 pb-3 pt-2 text-sm transition-colors duration-fast ease-standard',
        'disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-brand font-semibold text-fg'
          : 'border-transparent font-medium text-fg-secondary hover:text-fg'
      )}
    >
      {children}
    </button>
  );
}

export interface TabPanelProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ value, children, className }: TabPanelProps) {
  const { value: current, baseId } = useTabs('TabPanel');
  return (
    <div
      role="tabpanel"
      id={panelId(baseId, value)}
      aria-labelledby={tabId(baseId, value)}
      hidden={current !== value}
      tabIndex={0}
      className={cx('pt-5', className)}
    >
      {children}
    </div>
  );
}

export default Tabs;
