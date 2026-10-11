import { useFormContext } from 'react-hook-form';
import type { ProviderManifest } from '../../../../../shared/types/provider.types';
import { LocationCombobox } from '../../../../components/LocationCombobox';
import { kindLabel, unitCountLabel } from '../../../../components/locationFormat';
import { Card } from '../../../../components/ui';
import { useSetWatchField } from '../../form/useSetWatchField';
import type { WatchFormValues } from '../../form/watchFormSchema';
import { PlacePhoto, type PhotoPlace } from '../../../../components/PlacePhoto';

export interface LocationStepProps {
  manifest: ProviderManifest;
  /** The chosen place as the catalogue has it, for its photo. */
  place?: PhotoPlace;
  placeLoading?: boolean;
}

/** Step 2: which of the provider's places, shown with its photo once chosen. */
export function LocationStep({ manifest, place, placeLoading }: LocationStepProps) {
  const { watch, formState } = useFormContext<WatchFormValues>();
  const set = useSetWatchField();
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
