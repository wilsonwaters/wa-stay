import { Search } from 'lucide-react';
import { Field, SegmentedControl, TextField } from '../../../components/ui';
import { ALL, type BookingListParams, type FilterOption } from './listParams';

export interface BookingFiltersProps {
  params: BookingListParams;
  /** Undefined hides the provider filter (provider details could not be loaded). */
  providerOptions: FilterOption[] | undefined;
  onChange: (params: BookingListParams) => void;
}

/** The provider filter (always shown once known, §12.9) and the search, as on Watches. */
export function BookingFilters({ params, providerOptions, onChange }: BookingFiltersProps) {
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
            value={params.provider ?? ALL}
            onValueChange={(value) =>
              onChange({ ...params, provider: value === ALL ? undefined : value })
            }
          />
        </div>
      )}
      <Field label="Search trips" className="w-full max-w-xs">
        <TextField
          type="search"
          leadingIcon={<Search size={16} />}
          placeholder="Place, area or reference"
          autoComplete="off"
          value={params.q}
          onChange={(event) => onChange({ ...params, q: event.target.value })}
        />
      </Field>
    </div>
  );
}

export default BookingFilters;
