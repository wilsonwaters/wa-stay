import { useId, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { placesLabel } from '../../../components/locationFormat';
import { Button, Checkbox, Chip, Popover, Tooltip } from '../../../components/ui';
import type { FacetOption } from './facets';

export interface FilterChipProps {
  /** "Region". With one chosen the chip reads "Region · 1" and is named "Region, 1 selected". */
  label: string;
  options: FacetOption[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  /** Says how the options combine, under the list, e.g. "Places with all of these". */
  hint?: ReactNode;
}

/**
 * A filter chip that opens a Popover of checkboxes, each with how many places it gives.
 * Changes apply at once; Done or Escape closes it and returns focus to the chip. An option
 * that would give no places is disabled unless it is already chosen.
 */
export function FilterChip({ label, options, selected, onChange, hint }: FilterChipProps) {
  const id = useId();
  const count = selected.length;
  const toggle = (value: string, on: boolean) =>
    onChange(on ? [...selected, value] : selected.filter((v) => v !== value));

  return (
    <Popover
      label={label}
      padding="none"
      className="w-72"
      trigger={
        <Chip
          selected={count > 0}
          aria-label={count > 0 ? `${label}, ${count} selected` : undefined}
          trailingIcon={<ChevronDown size={16} aria-hidden="true" className="-mr-1" />}
        >
          {label}
          {count > 0 && <span className="tabular-nums">· {count}</span>}
        </Chip>
      }
    >
      {({ close }) => (
        <div className="flex flex-col">
          <fieldset className="max-h-80 overflow-y-auto px-4 pb-2 pt-4">
            <legend className="sr-only">{label}</legend>
            <div className="flex flex-col gap-3">
              {options.map((option) => {
                const checked = selected.includes(option.value);
                return (
                  <Checkbox
                    key={option.value}
                    id={`${id}-${options.indexOf(option)}`}
                    checked={checked}
                    disabled={!checked && option.count === 0}
                    onChange={(event) => toggle(option.value, event.target.checked)}
                    aria-label={`${option.label}, ${placesLabel(option.count)}`}
                    label={
                      <>
                        {option.label}
                        <span className="ml-2 font-normal tabular-nums text-fg-muted">
                          {option.count}
                        </span>
                      </>
                    }
                  />
                );
              })}
            </div>
            {hint && <p className="mt-3 text-xs text-fg-muted">{hint}</p>}
          </fieldset>
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
            <Button variant="ghost" size="sm" disabled={count === 0} onClick={() => onChange([])}>
              Clear
            </Button>
            <Button variant="secondary" size="sm" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Popover>
  );
}

export interface ToggleChipProps {
  label: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  /**
   * Why it cannot be used right now ("Add dates to filter by availability"). It is then off,
   * `aria-disabled` but still focusable, and says why in a tooltip that describes it.
   */
  unavailableReason?: string;
}

/** An on/off chip (`aria-pressed`), such as "Book online". */
export function ToggleChip({
  label,
  pressed,
  onPressedChange,
  unavailableReason,
}: ToggleChipProps) {
  if (unavailableReason) {
    return (
      <Tooltip content={unavailableReason}>
        <Chip pressed={false} aria-disabled>
          {label}
        </Chip>
      </Tooltip>
    );
  }
  return (
    <Chip pressed={pressed} onClick={() => onPressedChange(!pressed)}>
      {label}
    </Chip>
  );
}
