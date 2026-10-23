import type { Ref } from 'react';
import { Clock } from 'lucide-react';
import type { UnitSummary } from '../../../shared/types/catalog.types';
import type {
  LocationAvailability,
  ProviderId,
  SplitStay,
} from '../../../shared/types/provider.types';
import { stayRangeLabel, type UnitNoun } from '../../components/nightGridModel';
import { NightGrid } from '../../components/NightGrid';
import { SplitStays } from '../../components/SplitStays';
import { Notice } from '../../components/ui';
import { PlaceSection } from './PlaceSections';
import { formatOpensAt } from './placeModel';

const NO_SPLIT_STAYS: readonly SplitStay[] = [];

export interface AvailabilitySectionProps {
  availability: LocationAvailability;
  /**
   * The stay's split stays (`LocationCheck.splitStays`): free every night only by moving between
   * units. Shown under the grid when there are any.
   */
  splitStays?: readonly SplitStay[];
  /** The place's name, for "Contact {place}". */
  place: string;
  providerId: ProviderId;
  /** The stay the results are for (what was checked). */
  arrival: string;
  departure: string;
  /** False once the dates in the card differ from the ones checked. */
  current: boolean;
  unitNoun: UnitNoun;
  currency?: string;
  /** The provider's short name, for nights it did not report. */
  source: string;
  /** The provider's time zone, for the release time. */
  timeZone: string;
  summaryRef: Ref<HTMLParagraphElement>;
  /** The place's units, by unit id, for their limits and descriptions under their names. */
  unitDetails?: ReadonlyMap<string, UnitSummary>;
}

/**
 * The results of "Check availability": when bookings open (if not yet), the night grid, and,
 * once the dates change, which dates the results are for, so an old grid is never read
 * against new dates. Under the grid, the stay's split stays, when it has any: how to book a
 * stay free every night only by moving between units.
 */
export function AvailabilitySection({
  availability,
  splitStays = NO_SPLIT_STAYS,
  place,
  providerId,
  arrival,
  departure,
  current,
  unitNoun,
  currency,
  source,
  timeZone,
  summaryRef,
  unitDetails,
}: AvailabilitySectionProps) {
  const range = stayRangeLabel(arrival, departure);
  const release = availability.release;
  const opensAt = release?.opensAt ? formatOpensAt(release.opensAt, timeZone) : null;
  return (
    <PlaceSection title="Availability">
      <div className="flex flex-col gap-6">
        <NightGrid
          units={availability.units}
          arrival={arrival}
          departure={departure}
          unitNoun={unitNoun}
          currency={currency}
          source={source}
          caption={`Availability by night, ${range}`}
          summaryRef={summaryRef}
          unitDetails={unitDetails}
        >
          {!current && (
            <Notice tone="info" title={`Results for ${range}`}>
              Your dates have changed since this check. Check availability to see the new ones.
            </Notice>
          )}
          {release && !release.open && (
            <Notice tone="warning" icon={Clock}>
              {opensAt
                ? `Bookings for these dates open ${opensAt}.`
                : "Bookings for these dates aren't open yet."}
            </Notice>
          )}
        </NightGrid>
        <SplitStays
          splitStays={splitStays}
          place={place}
          providerId={providerId}
          shortName={source}
          arrival={arrival}
          departure={departure}
          noun={unitNoun}
          currency={currency}
        />
      </div>
    </PlaceSection>
  );
}
