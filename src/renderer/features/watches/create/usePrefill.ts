import { useMemo } from 'react';
import { useLocation } from 'react-router';
import { toApiError, useLocationDetail } from '../../../api';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { toLocationChoice } from '../../../components/LocationCombobox';
import { emptyWatchForm } from '../form/watchFormMapping';
import type { WatchFormValues } from '../form/watchFormSchema';
import type { FlowStepId } from './steps/ReviewStep';
import { parseWatchPrefill } from './prefill';

export interface ResolvedPrefill {
  /** False while the link's location is still being looked up. */
  ready: boolean;
  values: WatchFormValues;
  step: FlowStepId;
  notices: string[];
}

/**
 * The create-watch form as the URL's prefill query (§12.10) sets it up: provider, location,
 * dates and guests, and the step to open on (the first the link did not settle, else Your
 * stay). The place comes from `catalog.get`, the same detail the place page shows (and caches).
 */
export function usePrefill(manifests: readonly ProviderManifest[]): ResolvedPrefill {
  const { search } = useLocation();
  const prefill = useMemo(() => parseWatchPrefill(search, manifests), [search, manifests]);
  const watchProviders = manifests.filter((m) => m.capabilities.watches);
  const manifest =
    manifests.find((m) => m.id === prefill.providerId) ??
    (watchProviders.length === 1 ? watchProviders[0] : undefined);

  const key =
    prefill.providerId && prefill.locationId ? `${prefill.providerId}:${prefill.locationId}` : null;
  const detail = useLocationDetail(key);
  // A summary from a search already in the cache names the place at once.
  const place = detail.data;
  const ready = !key || Boolean(place) || detail.isError;

  return useMemo(() => {
    const values = emptyWatchForm(manifest);
    const notices = [...prefill.notices];
    if (place) values.location = toLocationChoice(place);
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
    const step: FlowStepId = !prefill.providerId ? 'provider' : place ? 'stay' : 'location';
    return { ready, values, step, notices };
  }, [manifest, prefill, ready, key, place, detail.isError, detail.error]);
}
