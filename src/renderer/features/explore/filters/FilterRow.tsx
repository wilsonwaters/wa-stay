import type { UnitKind } from '../../../../shared/types/provider.types';
import { Button } from '../../../components/ui';
import type { ExploreParams } from '../state/exploreParams';
import { hasActiveFilters } from '../state/exploreParams';
import type { ExploreFacets } from './facets';
import { FilterChip, ToggleChip } from './FilterChip';

export interface FilterRowProps {
  params: ExploreParams;
  facets: ExploreFacets;
  /**
   * False when fewer than two stay types are offered (the catalogue's, and any chosen that it
   * lacks): the Stay type chip is then left out.
   */
  showStayTypes: boolean;
  onChange: (patch: Partial<ExploreParams>) => void;
  onClearAll: () => void;
  /**
   * "Available only" (E3): on while `params.avail` is, unless `availableOnlyUnavailable` says
   * why it cannot be used (no dates, or no provider reports availability in bulk).
   */
  availableOnlyUnavailable?: string;
  onAvailableOnlyChange: (on: boolean) => void;
}

/**
 * Explore's filters: Provider (always shown, §12.9), Stay type, Region, Facilities, a "Book
 * online" toggle, an "Available only" toggle for the dates chosen, and "Clear all" while any is
 * on. Options within a chip are OR-ed; chips are AND-ed.
 */
export function FilterRow({
  params,
  facets,
  showStayTypes,
  onChange,
  onClearAll,
  availableOnlyUnavailable,
  onAvailableOnlyChange,
}: FilterRowProps) {
  const availableOnly = params.avail && !availableOnlyUnavailable;
  return (
    <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2">
      <FilterChip
        label="Provider"
        options={facets.providers}
        selected={params.providers}
        onChange={(providers) => onChange({ providers })}
      />
      {showStayTypes && (
        <FilterChip
          label="Stay type"
          options={facets.stayTypes}
          selected={params.stayTypes}
          onChange={(stayTypes) => onChange({ stayTypes: stayTypes as UnitKind[] })}
          hint="Places with any of these"
        />
      )}
      <FilterChip
        label="Region"
        options={facets.regions}
        selected={params.regions}
        onChange={(regions) => onChange({ regions })}
      />
      <FilterChip
        label="Facilities"
        options={facets.amenities}
        selected={params.amenities}
        onChange={(amenities) => onChange({ amenities })}
        hint="Shows places that have every facility you tick."
      />
      <ToggleChip
        label="Book online"
        pressed={params.online}
        onPressedChange={(online) => onChange({ online })}
      />
      <ToggleChip
        label="Available only"
        pressed={availableOnly}
        onPressedChange={onAvailableOnlyChange}
        unavailableReason={availableOnlyUnavailable}
      />
      {(hasActiveFilters(params) || availableOnly) && (
        <Button variant="ghost" size="sm" shape="pill" onClick={onClearAll}>
          Clear all
        </Button>
      )}
    </div>
  );
}
