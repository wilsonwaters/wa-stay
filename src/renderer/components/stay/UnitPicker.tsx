import { useMemo, type ReactNode } from 'react';
import type { UnitSummary } from '../../../shared/types/catalog.types';
import type { UnitNoun } from '../nightGridModel';
import { Checkbox, Disclosure } from '../ui';

export type { UnitNoun };

export interface UnitPickerProps {
  units: readonly UnitSummary[];
  /** Chosen unit ids. Older records may name units instead; those match by name. */
  value: readonly string[];
  onChange: (unitIds: string[]) => void;
  /** What a unit is called here, e.g. site / sites. */
  noun: UnitNoun;
  /** The heading. Default "Preferred {sites}". */
  label?: string;
  /** What choosing none means for the caller, after the summary ("Any site."). */
  hint?: ReactNode;
}

const OTHER = 'Other';
const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Whether `value` chooses `unit`, by id or (older records) by name. */
export function choosesUnit(value: readonly string[], unit: UnitSummary): boolean {
  return value.includes(unit.unitId) || value.includes(unit.unitName);
}

/**
 * Optional unit preferences, grouped by unit type ("Powered site", "Tent only"…): a group of
 * several has an "All {type}" box and a box per unit. A location with one unit per type (unit
 * classes) lists its units without groups. Nothing chosen means any unit. Chosen units the
 * location no longer lists are kept until unticked. Shared by watches and snipes: the caller
 * says what choosing none means (`hint`).
 */
export function UnitPicker({ units, value, onChange, noun, label, hint }: UnitPickerProps) {
  const groups = useMemo(() => {
    const byType = new Map<string, UnitSummary[]>();
    for (const unit of units) {
      const type = unit.unitType?.trim() || OTHER;
      byType.set(type, [...(byType.get(type) ?? []), unit]);
    }
    return [...byType.entries()];
  }, [units]);
  // A location listed by unit class (one unit per class, such as ParkStay's class-listed
  // campgrounds) has nothing to group: its few units are listed as they are.
  const flat = groups.every(([, list]) => list.length === 1);
  const kept = value.filter((id) => !units.some((u) => u.unitId === id || u.unitName === id));
  const chosen = units.filter((unit) => choosesUnit(value, unit)).length + kept.length;

  const without = (drop: readonly UnitSummary[]) =>
    value.filter((id) => !drop.some((u) => u.unitId === id || u.unitName === id));
  const setUnits = (list: readonly UnitSummary[], on: boolean) =>
    onChange(on ? [...without(list), ...list.map((u) => u.unitId)] : without(list));

  const summary =
    chosen === 0 ? `Any ${noun.one}` : `${chosen} ${chosen === 1 ? noun.one : noun.many} chosen`;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-semibold text-fg">{label ?? `Preferred ${noun.many}`}</p>
      <p className="text-sm text-fg-muted">
        {summary}.{hint ? <> {hint}</> : null}
      </p>
      <Disclosure summary={`Choose ${noun.many}`}>
        <div className="flex flex-col gap-4">
          {flat ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {units.map((unit) => (
                <Checkbox
                  key={unit.unitId}
                  label={unit.unitName}
                  description={
                    unit.unitType && unit.unitType !== unit.unitName ? unit.unitType : undefined
                  }
                  checked={choosesUnit(value, unit)}
                  onChange={(event) => setUnits([unit], event.target.checked)}
                />
              ))}
            </div>
          ) : (
            groups.map(([type, list]) => {
              const ticked = list.filter((unit) => choosesUnit(value, unit)).length;
              return (
                <fieldset key={type} className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-semibold text-fg">{type}</legend>
                  {list.length > 1 && (
                    <Checkbox
                      label={`All ${type === OTHER ? `other ${noun.many}` : type} (${list.length})`}
                      checked={ticked === list.length}
                      ref={(box) => {
                        if (box) box.indeterminate = ticked > 0 && ticked < list.length;
                      }}
                      onChange={(event) => setUnits(list, event.target.checked)}
                    />
                  )}
                  <div
                    className={
                      list.length > 1 ? 'grid grid-cols-2 gap-2 pl-6 sm:grid-cols-3' : 'grid gap-2'
                    }
                  >
                    {list.map((unit) => (
                      <Checkbox
                        key={unit.unitId}
                        label={unit.unitName}
                        checked={choosesUnit(value, unit)}
                        onChange={(event) => setUnits([unit], event.target.checked)}
                      />
                    ))}
                  </div>
                </fieldset>
              );
            })
          )}
          {kept.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-semibold text-fg">
                {capitalise(noun.many)} no longer listed
              </legend>
              {kept.map((id) => (
                <Checkbox
                  key={id}
                  label={id}
                  checked
                  onChange={() => onChange(value.filter((v) => v !== id))}
                />
              ))}
            </fieldset>
          )}
        </div>
      </Disclosure>
    </div>
  );
}

export default UnitPicker;
