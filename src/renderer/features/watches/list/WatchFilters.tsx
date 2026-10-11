import { SegmentedControl } from '../../../components/ui';
import {
  ALL,
  STATUS_OPTIONS,
  type FilterOption,
  type WatchFilters as Filters,
} from './listFilters';

export interface WatchFiltersProps {
  filters: Filters;
  /** Undefined hides the provider filter (provider details could not be loaded). */
  providerOptions: FilterOption[] | undefined;
  onChange: (filters: Filters) => void;
}

/** Provider (always shown once known, §12.9) and status filters for the Watches list. */
export function WatchFilters({ filters, providerOptions, onChange }: WatchFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
      {providerOptions && (
        <div className="flex flex-col gap-1.5">
          <span aria-hidden="true" className="text-sm font-semibold text-fg">
            Provider
          </span>
          <SegmentedControl
            label="Provider"
            options={providerOptions}
            value={filters.provider ?? ALL}
            onValueChange={(value) =>
              onChange({ ...filters, provider: value === ALL ? undefined : value })
            }
          />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span aria-hidden="true" className="text-sm font-semibold text-fg">
          Status
        </span>
        <SegmentedControl
          label="Status"
          options={[...STATUS_OPTIONS]}
          value={filters.status}
          onValueChange={(value) => onChange({ ...filters, status: value as Filters['status'] })}
        />
      </div>
    </div>
  );
}

export default WatchFilters;
