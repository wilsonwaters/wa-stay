import { useMemo } from 'react';
import { useLocation } from 'react-router';
import { toApiError, useLocationDetail } from '../../../api';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { toLocationChoice } from '../../../components/LocationCombobox';
import { parseSnipePrefill } from './prefill';
import { emptySnipeForm, type SnipeFormValues, type SnipeStepId } from './snipeForm';

export interface ResolvedSnipePrefill {
  /** False while the link's location is still being looked up. */
  ready: boolean;
  values: SnipeFormValues;
  step: SnipeStepId;
  notices: string[];
}

/**
 * The new-snipe form as the URL's prefill query (§12.10) sets it up: provider, location, dates
 * and guests, and the step to open on (the first the link did not settle, else Your stay). The
 * place comes from `catalog.get`, the same detail the place page shows (and caches).
 */
export function useSnipePrefill(manifests: readonly ProviderManifest[]): ResolvedSnipePrefill {
  const { search } = useLocation();
  const prefill = useMemo(() => parseSnipePrefill(search, manifests), [search, manifests]);
  const snipeProviders = manifests.filter((m) => m.capabilities.snipes);
  const manifest =
    manifests.find((m) => m.id === prefill.providerId) ??
    (snipeProviders.length === 1 ? snipeProviders[0] : undefined);

  const key =
    prefill.providerId && prefill.locationId ? `${prefill.providerId}:${prefill.locationId}` : null;
  const detail = useLocationDetail(key);
  const place = detail.data;
  const ready = !key || Boolean(place) || detail.isError;

  return useMemo(() => {
    const values = emptySnipeForm(manifest);
    const notices = [...prefill.notices];
    if (place?.bookingMode && place.bookingMode !== 'online') {
      notices.push(`${place.name} can't be booked online, so choose another location.`);
    } else if (place) values.location = toLocationChoice(place);
    else if (key && detail.isError) {
      notices.push(
        toApiError(detail.error).code === 'NOT_FOUND'
          ? "The link's place couldn't be found, so choose a location."
          : "The link's place couldn't be loaded, so choose a location."
      );
    }
    if (prefill.arrival && prefill.departure) {
      values.arrival = prefill.arrival;
      values.departure = prefill.departure;
    }
    if (prefill.adults) values.adults = prefill.adults;
    if (prefill.children !== undefined) values.children = prefill.children;
    const step: SnipeStepId = !prefill.providerId
      ? 'provider'
      : values.location
        ? 'stay'
        : 'location';
    return { ready, values, step, notices };
  }, [manifest, prefill, ready, key, place, detail.isError, detail.error]);
}
