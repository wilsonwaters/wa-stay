import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { UnitSummary } from '../../../shared/types/catalog.types';
import type { UnitKind } from '../../../shared/types/provider.types';
import { unitKindOfUnit } from '../../../shared/utils/unit-kinds';
import {
  capitalise,
  nounForKinds,
  nounOfUnits,
  unitCountLabel,
  type UnitNoun,
} from '../../../shared/utils/unit-noun';
import { Checkbox, Disclosure } from '../ui';
import { orderedKinds, stayTypeLabel } from './stayTypes';

export type { UnitNoun };

export interface UnitPickerProps {
  units: readonly UnitSummary[];
  /** Chosen unit ids. Older records may name units instead; those match by name. */
  value: readonly string[];
  onChange: (unitIds: string[]) => void;
  /** What the units listed are called (`stayNoun`), e.g. site / sites. */
  noun: UnitNoun;
  /** The heading. Default "Preferred {sites}". */
  label?: string;
  /** What choosing none means for the caller, after the summary ("Any site."). */
  hint?: ReactNode;
  /**
   * The chosen stay types, where the caller offers them: only units of these kinds are listed
   * (none chosen lists every unit), and turning a kind off unticks its units, with a status
   * line that says so. Leave it undefined where stay types are not offered.
   */
  kinds?: readonly UnitKind[];
}

const OTHER = 'Other';
const ANY_KIND: readonly UnitKind[] = [];

/** Whether `value` chooses `unit`, by id or (older records) by name. */
export function choosesUnit(value: readonly string[], unit: UnitSummary): boolean {
  return value.includes(unit.unitId) || value.includes(unit.unitName);
}

/** `value` without the ids (or names) of `drop`. */
function without(value: readonly string[], drop: readonly UnitSummary[]): string[] {
  return value.filter((id) => !drop.some((u) => u.unitId === id || u.unitName === id));
}

/** Units by unit type ("Powered site", "Tent only"…), in the order they are listed. */
function byType(units: readonly UnitSummary[]): [string, UnitSummary[]][] {
  const groups = new Map<string, UnitSummary[]>();
  for (const unit of units) {
    const type = unit.unitType?.trim() || OTHER;
    groups.set(type, [...(groups.get(type) ?? []), unit]);
  }
  return [...groups.entries()];
}

interface UnitBoxesProps {
  units: readonly UnitSummary[];
  value: readonly string[];
  /** What these units are called: the picker's, or in a stay-type group that kind's. */
  noun: UnitNoun;
  /** Inside a stay-type group, whose heading already says what the units are. */
  nested?: boolean;
  setUnits: (list: readonly UnitSummary[], on: boolean) => void;
}

/**
 * One set of units' boxes: grouped by unit type, a group of several with an "All {type}" box;
 * or, for units listed by class (one unit per type), the units as they are. In a stay-type
 * group whose units have no unit type, the stay type's heading is theirs: no "Other" under it,
 * and "All bunks (2)".
 */
function UnitBoxes({ units, value, noun, nested = false, setUnits }: UnitBoxesProps) {
  const groups = byType(units);
  // A location listed by unit class (one unit per class, such as ParkStay's class-listed
  // campgrounds) has nothing to group: its few units are listed as they are.
  if (groups.every(([, list]) => list.length === 1)) {
    return (
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
    );
  }
  // The stay type's heading says it already
  const untyped = nested && groups.length === 1 && groups[0][0] === OTHER;
  return (
    <>
      {groups.map(([type, list]) => {
        const ticked = list.filter((unit) => choosesUnit(value, unit)).length;
        const all = untyped ? noun.many : type === OTHER ? `other ${noun.many}` : type;
        const Group = untyped ? 'div' : 'fieldset';
        return (
          <Group key={type} className="flex flex-col gap-2">
            {!untyped && <legend className="mb-2 text-sm font-semibold text-fg">{type}</legend>}
            {list.length > 1 && (
              <Checkbox
                label={`All ${all} (${list.length})`}
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
          </Group>
        );
      })}
    </>
  );
}

/**
 * Optional unit preferences, grouped by unit type ("Powered site", "Tent only"…): a group of
 * several has an "All {type}" box and a box per unit. A location with one unit per type (unit
 * classes) lists its units without groups. Units of two or more stay types are grouped by stay
 * type first ("Camping", "Cabins & villas"), units with no kind last, under "Other". Nothing
 * chosen means any unit. Chosen units the location no longer lists are kept until unticked.
 * Shared by watches and snipes: the caller says what choosing none means (`hint`), and passes
 * the chosen stay types (`kinds`) where it offers them.
 */
export function UnitPicker({ units, value, onChange, noun, label, hint, kinds }: UnitPickerProps) {
  const chosenKinds = kinds ?? ANY_KIND;
  // A unit of a kind not chosen stays listed while it is ticked (an edited watch may have
  // stored both), so a choice is never hidden.
  const listed = useMemo(
    () =>
      chosenKinds.length === 0
        ? units
        : units.filter(
            (unit) => chosenKinds.includes(unitKindOfUnit(unit)) || choosesUnit(value, unit)
          ),
    [units, value, chosenKinds]
  );
  const byKind = useMemo(() => {
    const groups = new Map<UnitKind, UnitSummary[]>();
    for (const unit of listed) {
      const kind = unitKindOfUnit(unit);
      groups.set(kind, [...(groups.get(kind) ?? []), unit]);
    }
    return orderedKinds(groups.keys()).map((kind) => [kind, groups.get(kind) ?? []] as const);
  }, [listed]);
  const kept = value.filter((id) => !units.some((u) => u.unitId === id || u.unitName === id));
  const chosenUnits = units.filter((unit) => choosesUnit(value, unit));
  const chosen = chosenUnits.length + kept.length;

  const setUnits = (list: readonly UnitSummary[], on: boolean) =>
    onChange(on ? [...without(value, list), ...list.map((u) => u.unitId)] : without(value, list));

  // Turning a stay type off unticks its units: main matches chosen units alone, so a ticked
  // unit of a kind no longer chosen would contradict the stay types.
  const [status, setStatus] = useState('');
  const kindsKey = kinds?.join(',');
  const lastKinds = useRef(kindsKey);
  const latest = useRef({ units, value, onChange, noun });
  latest.current = { units, value, onChange, noun };
  useEffect(() => {
    if (lastKinds.current === kindsKey) return;
    lastKinds.current = kindsKey;
    const now = latest.current;
    const wanted = kindsKey ? kindsKey.split(',') : [];
    const dropped =
      wanted.length === 0
        ? []
        : now.units.filter(
            (unit) => choosesUnit(now.value, unit) && !wanted.includes(unitKindOfUnit(unit))
          );
    if (dropped.length === 0) {
      setStatus('');
      return;
    }
    now.onChange(without(now.value, dropped));
    // Named by what they are: the sites unticked when only cabins are chosen are sites
    const noun = nounOfUnits(dropped, now.noun);
    setStatus(`${unitCountLabel(dropped.length, noun)} unticked: not in the chosen stay types`);
  }, [kindsKey]);

  const summary =
    chosen === 0
      ? `Any ${noun.one}`
      : `${unitCountLabel(chosen, nounOfUnits(chosenUnits, noun))} chosen`;
  const boxes = (list: readonly UnitSummary[], kind?: UnitKind) => (
    <UnitBoxes
      units={list}
      value={value}
      noun={kind ? nounForKinds([kind]) : noun}
      nested={kind !== undefined}
      setUnits={setUnits}
    />
  );

  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-semibold text-fg">{label ?? `Preferred ${noun.many}`}</p>
      <p className="text-sm text-fg-muted">
        {summary}.{hint ? <> {hint}</> : null}
      </p>
      {kinds !== undefined && (
        <p role="status" className="text-sm text-fg-muted">
          {status}
        </p>
      )}
      {chosenKinds.length > 0 && listed.length === 0 && kept.length === 0 ? (
        <p className="text-sm text-fg-muted">No {noun.many} listed.</p>
      ) : (
        <Disclosure summary={`Choose ${noun.many}`}>
          <div className="flex flex-col gap-4">
            {byKind.length > 1
              ? byKind.map(([kind, list]) => (
                  <fieldset key={kind} className="flex flex-col gap-4">
                    <legend className="mb-2 text-base font-semibold text-fg">
                      {stayTypeLabel(kind)}
                    </legend>
                    {boxes(list, kind)}
                  </fieldset>
                ))
              : boxes(listed)}
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
      )}
    </div>
  );
}

export default UnitPicker;
