import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Check, ChevronDown, CircleAlert } from 'lucide-react';
import { Portal } from './Portal';
import { SegmentMessages } from './SegmentMessages';
import { CONTROL_CLASS } from './controlStyles';
import { cx } from './cx';
import { usePosition } from './usePosition';

export interface ComboboxOption {
  value: string;
  label: string;
  /** A second line, e.g. the park or region. */
  description?: string;
  /** Options with the same group are listed together under that heading. */
  group?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  label: string;
  options: ComboboxOption[];
  /** The chosen option's value (controlled). */
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (value: string | null, option: ComboboxOption | null) => void;
  /** The text in the input (controlled). Pair with `filter={false}` to filter options yourself. */
  inputValue?: string;
  onInputChange?: (text: string) => void;
  /** `false` shows `options` as given; the default matches the label, ignoring case. */
  filter?: false | ((option: ComboboxOption, query: string) => boolean);
  placeholder?: string;
  /** Shown under the label; in a `segment`, read by screen readers only. */
  hint?: ReactNode;
  /** Marks the input invalid; shown under the value and read with it. */
  error?: ReactNode;
  /** `field` (default) for forms; `segment` for a segment of the Explore search pill. */
  appearance?: 'field' | 'segment';
  emptyMessage?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * The list's tallest (30rem): 8 two-line options under 3 group headings without scrolling,
 * which fits below Explore's "Where" at the 640 px minimum window. Never more than the room on
 * its side of the input (`usePosition`'s `available`), so it never covers the input.
 */
const LIST_MAX_HEIGHT_PX = 480;

const matchesLabel = (option: ComboboxOption, query: string) =>
  option.label.toLowerCase().includes(query.trim().toLowerCase());

/**
 * An editable combobox with list autocomplete (WAI-ARIA 1.2): typing filters the listbox,
 * ↑/↓ move the highlighted option (`aria-activedescendant`), Enter chooses it, Escape closes
 * the list and a second Escape clears, Tab closes. Options come from props.
 */
export function Combobox({
  label,
  options,
  value: valueProp,
  defaultValue = null,
  onChange,
  inputValue,
  onInputChange,
  filter,
  placeholder,
  hint,
  error,
  appearance = 'field',
  emptyMessage = 'No matches',
  disabled,
  id: idProp,
  className,
}: ComboboxProps) {
  const generated = useId();
  const inputId = idProp ?? `combobox${generated}`;
  const listboxId = `${inputId}-listbox`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  const [innerValue, setInnerValue] = useState<string | null>(defaultValue);
  const value = valueProp !== undefined ? valueProp : innerValue;
  const selected = options.find((o) => o.value === value) ?? null;

  const [innerText, setInnerText] = useState(selected?.label ?? '');
  const text = inputValue ?? innerText;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { style, available } = usePosition(anchorRef, listRef, { open, offset: 4 });
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    if (open) setWidth(anchorRef.current?.offsetWidth || undefined);
  }, [open]);

  // Show the chosen option's label when the value changes from outside.
  const selectedLabel = selected?.label ?? '';
  useEffect(() => {
    if (inputValue === undefined) setInnerText(selectedLabel);
  }, [selectedLabel, inputValue]);

  const visible =
    filter === false || !query.trim()
      ? options
      : options.filter((o) => (filter ?? matchesLabel)(o, query));
  const selectable = visible.filter((o) => !o.disabled);
  const activeOption = active >= 0 ? selectable[active] : undefined;
  const optionId = (option: ComboboxOption) => `${listboxId}-${visible.indexOf(option)}`;

  useEffect(() => {
    if (!activeOption) return;
    document.getElementById(optionId(activeOption))?.scrollIntoView?.({ block: 'nearest' });
  });

  const setText = (next: string) => {
    if (inputValue === undefined) setInnerText(next);
    onInputChange?.(next);
  };

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const commit = (option: ComboboxOption | null) => {
    if (valueProp === undefined) setInnerValue(option?.value ?? null);
    onChange?.(option?.value ?? null, option);
    setText(option?.label ?? '');
    setQuery('');
    close();
  };

  const openAt = (index: number) => {
    setOpen(true);
    setActive(selectable.length ? index : -1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = selectable.length;
    const selectedIndex = selected ? selectable.indexOf(selected) : -1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) return openAt(selectedIndex >= 0 ? selectedIndex : 0);
        if (count) setActive((active + 1) % count);
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) return openAt(selectedIndex >= 0 ? selectedIndex : count - 1);
        if (count) setActive(active <= 0 ? count - 1 : active - 1);
        return;
      case 'Enter':
        if (open && activeOption) {
          event.preventDefault();
          commit(activeOption);
        }
        return;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        } else if (text) {
          // Second Escape clears.
          event.preventDefault();
          event.stopPropagation();
          commit(null);
        }
        return;
      case 'Tab':
        close();
        return;
    }
  };

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    setText(event.target.value);
    setQuery(event.target.value);
    setOpen(true);
    setActive(-1);
  };

  const onBlur = () => {
    close();
    // Text that was typed but not chosen goes back to the chosen option.
    if (inputValue === undefined && query) {
      setInnerText(selectedLabel);
      setQuery('');
    }
  };

  const groups: { name: string; options: ComboboxOption[] }[] = [];
  for (const option of visible) {
    const name = option.group ?? '';
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.options.push(option);
    else groups.push({ name, options: [option] });
  }

  const renderOption = (option: ComboboxOption) => {
    const isActive = option === activeOption;
    return (
      <div
        key={option.value}
        id={optionId(option)}
        role="option"
        aria-selected={isActive}
        aria-disabled={option.disabled || undefined}
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => {
          if (!option.disabled) setActive(selectable.indexOf(option));
        }}
        onClick={() => {
          if (!option.disabled) commit(option);
        }}
        className={cx(
          // Two lines (48 px) are padded less than one (36 px), so 8 fit the list's height
          'flex cursor-pointer items-start gap-2 rounded-md px-3 text-sm',
          option.description ? 'py-1' : 'py-2',
          isActive ? 'bg-surface-subtle' : undefined,
          option.disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <Check
          size={16}
          aria-hidden="true"
          className={cx(
            'mt-0.5 shrink-0 text-brand',
            option === selected ? 'visible' : 'invisible'
          )}
        />
        <span className="flex min-w-0 flex-col">
          <span className="font-medium text-fg">{option.label}</span>
          {option.description && <span className="text-fg-muted">{option.description}</span>}
        </span>
      </div>
    );
  };

  const input = (
    <input
      id={inputId}
      type="text"
      role="combobox"
      aria-expanded={open}
      aria-controls={listboxId}
      aria-autocomplete="list"
      aria-activedescendant={open && activeOption ? optionId(activeOption) : undefined}
      aria-describedby={cx(hintId, errorId) || undefined}
      aria-invalid={error ? true : undefined}
      autoComplete="off"
      spellCheck={false}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      onChange={onInput}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onClick={() => {
        if (!open) setOpen(true);
      }}
      className={
        appearance === 'segment'
          ? 'w-full min-w-0 truncate border-0 bg-transparent p-0 text-sm text-fg focus-visible:outline-hidden disabled:cursor-not-allowed'
          : cx(CONTROL_CLASS, 'h-10 pl-3 pr-10')
      }
    />
  );

  return (
    <div className={cx(appearance === 'field' && 'flex flex-col gap-1.5', className)}>
      {appearance === 'segment' ? (
        <div
          ref={anchorRef}
          className="flex min-w-0 flex-col rounded-full px-6 py-2.5 transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-within:bg-surface focus-within:outline-solid focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus"
        >
          <label htmlFor={inputId} className="text-xs font-semibold text-fg">
            {label}
          </label>
          {input}
          <SegmentMessages hint={hint} hintId={hintId} error={error} errorId={errorId} />
        </div>
      ) : (
        <>
          <label htmlFor={inputId} className="text-sm font-semibold text-fg">
            {label}
          </label>
          {hint && (
            <p id={hintId} className="-mt-1 text-sm text-fg-muted">
              {hint}
            </p>
          )}
          <div ref={anchorRef} className="relative">
            {input}
            <ChevronDown
              size={18}
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-secondary"
            />
          </div>
          {error && (
            <p id={errorId} className="flex items-start gap-1.5 text-sm font-medium text-danger">
              <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}
        </>
      )}
      <Portal>
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={label}
          hidden={!open}
          style={{
            ...style,
            minWidth: width,
            maxHeight:
              available === undefined
                ? LIST_MAX_HEIGHT_PX
                : Math.min(LIST_MAX_HEIGHT_PX, available),
          }}
          className="z-overlay max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-pop"
        >
          {visible.length === 0 ? (
            <div
              role="option"
              aria-selected={false}
              aria-disabled="true"
              className="px-3 py-2 text-sm text-fg-muted"
            >
              {emptyMessage}
            </div>
          ) : (
            groups.map((group, index) =>
              group.name ? (
                <div key={group.name} role="group" aria-labelledby={`${listboxId}-g${index}`}>
                  <div
                    id={`${listboxId}-g${index}`}
                    role="presentation"
                    className="px-3 pb-1 pt-2 text-xs font-semibold text-fg-muted"
                  >
                    {group.name}
                  </div>
                  {group.options.map(renderOption)}
                </div>
              ) : (
                group.options.map(renderOption)
              )
            )
          )}
        </div>
      </Portal>
    </div>
  );
}

export default Combobox;
