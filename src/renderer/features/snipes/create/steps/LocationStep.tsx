import { useFormContext } from 'react-hook-form';
import type { LocationSummary } from '../../../../../shared/types/catalog.types';
import type { ProviderManifest } from '../../../../../shared/types/provider.types';
import { LocationCombobox } from '../../../../components/LocationCombobox';
import { PlacePhoto, type PhotoPlace } from '../../../../components/PlacePhoto';
import { kindLabel, unitCountLabel } from '../../../../components/locationFormat';
import { Card } from '../../../../components/ui';
import type { SnipeFormValues } from '../snipeForm';
import { useSetSnipeField } from '../useSetSnipeField';

/** A snipe holds a site online, so only places booked online can be chosen. */
export const notBookableOnline = (location: Pick<LocationSummary, 'bookingMode'>) =>
  location.bookingMode === 'online' ? undefined : 'Not bookable online';

export interface LocationStepProps {
  manifest: ProviderManifest;
  /** The chosen place as the catalogue has it, for its photo. */
  place?: PhotoPlace;
  placeLoading?: boolean;
}

/** Step 2: which of the provider's places, shown with its photo once chosen. */
export function LocationStep({ manifest, place, placeLoading }: LocationStepProps) {
  const { watch, formState } = useFormContext<SnipeFormValues>();
  const set = useSetSnipeField();
  const location = watch('location');

  return (
    <>
      <LocationCombobox
        providerId={manifest.id}
        providerName={manifest.shortName}
        value={location}
        onChange={(next) => {
          set('location', next);
          set('unitIds', []);
        }}
        unavailableReason={notBookableOnline}
        hint="Only places you can book online can be sniped."
        error={formState.errors.location?.message}
      />
      {location && (
        <Card padding="none" className="flex items-center gap-4 p-3">
          <PlacePhoto
            name={location.name}
            place={place}
            loading={placeLoading}
            className="aspect-4/3 w-28 rounded-md"
          />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-base font-semibold text-fg">{location.name}</p>
            <p className="text-sm text-fg-secondary">
              {[
                location.areaName,
                location.kind ? kindLabel(location.kind) : undefined,
                location.kind && location.unitCount
                  ? unitCountLabel(location.kind, location.unitCount)
                  : undefined,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </Card>
      )}
    </>
  );
}

export default LocationStep;
