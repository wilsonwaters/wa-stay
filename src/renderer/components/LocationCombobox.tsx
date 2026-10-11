import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LOCATION_SEARCH_MIN_CHARS,
  useCatalogStatus,
  useCatalogUpdates,
  useLocationSearch,
} from '../api/catalog';
import type { LocationSummary } from '../../shared/types/catalog.types';
import type { LocationKind, ProviderId } from '../../shared/types/provider.types';
import { areaLine } from './locationFormat';
import { Button, Combobox, Notice, useAnnounce, type ComboboxOption } from './ui';

/** Typing searches after this pause (the same as Explore's search). */
export const LOCATION_SEARCH_DEBOUNCE_MS = 250;

/** A chosen location: what a watch, snipe or booking stores, plus what the form shows. */
export interface LocationChoice {
  externalId: string;
  name: string;
  areaName?: string;
  kind?: LocationKind;
  unitCount?: number;
}

export function toLocationChoice(location: LocationSummary): LocationChoice {
  return {
    externalId: location.externalId,
    name: location.name,
    areaName: location.area?.name,
    kind: location.kind,
    unitCount: location.unitCount,
  };
}

export interface LocationComboboxProps {
  providerId: ProviderId;
  /** The provider's short name, for messages ("Locations from ParkStay are still loading"). */
  providerName: string;
  value: LocationChoice | null;
  onChange: (location: LocationChoice | null) => void;
  label?: string;
  hint?: string;
  /** A validation message, e.g. "Choose a location". */
  error?: string;
  /**
   * Why a place cannot be chosen here, e.g. "Not bookable online" for Site Sniper; such places
   * are listed, disabled, with the reason under their name.
   */
  unavailableReason?: (location: LocationSummary) => string | undefined;
}

const locationsLabel = (n: number) => `${n} ${n === 1 ? 'location' : 'locations'}`;

/**
 * Finds one provider's location by name (ARIA 1.2 combobox, D2 `Combobox`): searches the
 * catalogue in main from 2 characters, after a short pause, best match first. Announces how
 * many matched; a failed search shows Retry; a catalogue still syncing says so. U2 and U3 use
 * it too.
 *
 * A provider searched by map area (`catalogMode: 'search'`) has only the places seen so far
 * in the catalogue: with text search, main asks it too and this says "Searching…" until its
 * places arrive; without, a name that matches nothing suggests browsing it on Explore's map.
 */
export function LocationCombobox({
  providerId,
  providerName,
  value,
  onChange,
  label = 'Location',
  hint,
  error,
  unavailableReason,
}: LocationComboboxProps) {
  const [text, setText] = useState(value?.name ?? '');
  const [query, setQuery] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const choosing = useRef(false);
  const announce = useAnnounce();
  useEffect(() => () => clearTimeout(timer.current), []);

  useCatalogUpdates();
  const status = useCatalogStatus();
  const providerStatus = status.data?.providers.find((p) => p.providerId === providerId);
  // A synced catalogue still on its first sync. (A search-mode one never "arrives" whole.)
  const stillLoading = Boolean(
    providerStatus?.syncing && providerStatus.count === 0 && !providerStatus.search
  );
  // A search-mode provider that cannot be searched by name: only places seen on the map match.
  const browseOnly = providerStatus?.search?.textSearch === false;
  const browseHint = `Browse ${providerName} places on the Explore map to find more`;
  const { refetch: refetchStatus } = status;
  useEffect(() => {
    if (!stillLoading) return undefined;
    const poll = setInterval(() => void refetchStatus(), 3000);
    return () => clearInterval(poll);
  }, [stillLoading, refetchStatus]);

  const search = useLocationSearch({ providerId, text: query });
  const searching = query.trim().length >= LOCATION_SEARCH_MIN_CHARS;
  const typedEnough = text.trim().length >= LOCATION_SEARCH_MIN_CHARS;
  const items = useMemo(
    () => (searching && typedEnough ? (search.data?.items ?? []) : []),
    [searching, typedEnough, search.data]
  );
  // Main is still asking the provider about this text (a search-mode provider).
  const pending = search.waiting;
  const searchingMessage = `Searching ${providerName}…`;
  /** The text "Searching …" was last announced for, so it is said once per text. */
  const announcedSearching = useRef<string | null>(null);

  const valueKey = value ? `${providerId}:${value.externalId}` : null;
  const options: ComboboxOption[] = useMemo(() => {
    const list = items.map((item): ComboboxOption => {
      const reason = unavailableReason?.(item);
      return {
        value: item.key,
        label: item.name,
        description: [areaLine(item), reason].filter(Boolean).join(' · ') || undefined,
        disabled: reason !== undefined,
      };
    });
    if (value && valueKey && !list.some((o) => o.value === valueKey)) {
      list.push({ value: valueKey, label: value.name, description: value.areaName });
    }
    return list;
  }, [items, value, valueKey, unavailableReason]);

  // Tell screen-reader users how many matched, once a search for what was typed settles.
  const settled = searching && search.isSuccess && !search.isPlaceholderData;
  const total = search.data?.total ?? 0;
  const shown = search.data?.items.length ?? 0;
  useEffect(() => {
    if (!settled) return;
    if (total === 0) {
      // Its places may still arrive: say so once, and the outcome once the provider answered.
      if (pending) {
        if (announcedSearching.current === query) return;
        announcedSearching.current = query;
        announce(searchingMessage);
        return;
      }
      announce(browseOnly ? browseHint : `No locations match "${query.trim()}"`);
    } else if (total > shown) announce(`${shown} of ${locationsLabel(total)}`);
    else announce(locationsLabel(total));
  }, [settled, total, shown, query, announce, pending, browseOnly, browseHint, searchingMessage]);

  const onInputChange = (next: string) => {
    if (choosing.current) {
      choosing.current = false;
      return;
    }
    setText(next);
    if (value) onChange(null);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setQuery(next), LOCATION_SEARCH_DEBOUNCE_MS);
  };

  const onChoose = (key: string | null) => {
    if (key === null) {
      onChange(null);
      setText('');
      return;
    }
    const item = items.find((i) => i.key === key);
    if (!item || unavailableReason?.(item) !== undefined) return;
    choosing.current = true;
    setText(item.name);
    onChange(toLocationChoice(item));
  };

  const emptyMessage = !typedEnough
    ? `Type at least ${LOCATION_SEARCH_MIN_CHARS} letters`
    : search.isFetching && !search.data
      ? 'Searching…'
      : pending
        ? searchingMessage
        : browseOnly
          ? browseHint
          : `No locations match "${text.trim()}"`;

  return (
    <div className="flex flex-col gap-3">
      <Combobox
        label={label}
        hint={hint}
        error={error}
        options={options}
        value={valueKey}
        onChange={onChoose}
        inputValue={text}
        onInputChange={onInputChange}
        filter={false}
        placeholder={`Search ${providerName} by name or area`}
        emptyMessage={emptyMessage}
      />
      {stillLoading && (
        <Notice tone="info">
          Locations from {providerName} are still loading. You can search once they arrive.
        </Notice>
      )}
      {search.isError && (
        <Notice
          tone="danger"
          title="Locations couldn't be searched"
          actions={
            <Button variant="secondary" size="sm" onClick={() => void search.refetch()}>
              Retry
            </Button>
          }
        >
          {search.error.message}
        </Notice>
      )}
    </div>
  );
}

export default LocationCombobox;
