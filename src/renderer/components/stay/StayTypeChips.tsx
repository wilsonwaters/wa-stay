import { useId } from 'react';
import { CircleAlert } from 'lucide-react';
import type { UnitKind } from '../../../shared/types/provider.types';
import { Chip } from '../ui';
import { cx } from '../ui/cx';
import { orderedKinds, stayTypeLabel } from './stayTypes';

export interface StayTypeChipsProps {
  /** The stay types to offer (`stayTypeOptions`), in order. */
  options: readonly UnitKind[];
  /** The chosen stay types; none means any. */
  value: readonly UnitKind[];
  onChange: (kinds: UnitKind[]) => void;
  /** Validation message: marks the group invalid and reads with it; the group can take focus. */
  error?: string;
}

/**
 * "Stay type" in the watch and snipe flows (R6): a `role="group"` of on/off chips, one per
 * stay type a mixed place offers ("Camping", "Cabins & villas"). None pressed means any stay
 * type. The choice comes back in stay-type order, whatever order the chips were pressed in.
 */
export function StayTypeChips({ options, value, onChange, error }: StayTypeChipsProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const errorId = error ? `${id}-error` : undefined;
  const toggle = (kind: UnitKind) =>
    onChange(
      orderedKinds(value.includes(kind) ? value.filter((k) => k !== kind) : [...value, kind])
    );

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={cx(hintId, errorId)}
      aria-invalid={error ? true : undefined}
      tabIndex={error ? -1 : undefined}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-col gap-0.5">
        <span id={labelId} className="text-sm font-semibold text-fg">
          Stay type
        </span>
        <span id={hintId} className="text-sm text-fg-muted">
          Leave all off for any stay type.
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((kind) => (
          <Chip key={kind} pressed={value.includes(kind)} onClick={() => toggle(kind)}>
            {stayTypeLabel(kind)}
          </Chip>
        ))}
      </div>
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-sm font-medium text-danger">
          <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

export default StayTypeChips;
