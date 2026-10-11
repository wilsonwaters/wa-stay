import type { ReactNode } from 'react';
import type { UnitSummary } from '../../../../shared/types/catalog.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { Watch } from '../../../../shared/types/watch.types';
import { formatPrice } from '../../../components/nightGridModel';
import { partyLabel, stayNightsLabel, stayDatesLabel } from '../../../components/stay/stayFormat';
import { relativeTime, timeInZone } from '../../../components/timeFormat';
import { StatusPill } from '../../../components/ui';
import { intervalLabel } from '../form/watchFormSchema';
import type { UnitNoun } from '../../../components/nightGridModel';
import {
  autoHoldLabel,
  statusPillFor,
  unitNameOf,
  unitNounFor,
  type WatchState,
} from '../shared/watchState';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`summary-${title}`} className="flex flex-col gap-3">
      <h2 id={`summary-${title}`} className="text-lg font-semibold text-fg">
        {title}
      </h2>
      <dl className="flex flex-col gap-2 text-sm">{children}</dl>
    </section>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-fg-secondary">{label}</dt>
      <dd className="text-base text-fg">{children}</dd>
    </div>
  );
}

export interface WatchSummaryProps {
  watch: Watch;
  state: WatchState;
  manifest: ProviderManifest | undefined;
  today: string;
  now: Date;
  /** The place's units (its catalogue detail), for the chosen units' names. */
  units?: readonly UnitSummary[];
}

/** The chosen units by name: the place's, else the last check's, else "Site 12". */
function chosenUnits(watch: Watch, units: readonly UnitSummary[] | undefined, noun: UnitNoun) {
  return watch.unitIds
    .map(
      (id) =>
        units?.find((u) => u.unitId === id || u.unitName === id)?.unitName ??
        unitNameOf(watch, id, noun)
    )
    .join(', ');
}

/** The watch's stay, preferences and status, side by side (no cards inside cards). */
export function WatchSummary({ watch, state, manifest, today, now, units }: WatchSummaryProps) {
  const { stay } = watch;
  const noun = unitNounFor(manifest);
  const zone = manifest?.timezone ?? 'Australia/Perth';
  const params = (manifest?.stayFields ?? []).filter((f) => watch.stayParams[f.key] !== undefined);
  return (
    <div className="grid gap-8 md:grid-cols-3">
      <Group title="Stay">
        <Item label="Dates">
          {stayDatesLabel(stay.arrival, stay.departure, today)} ·{' '}
          {stayNightsLabel(stay.arrival, stay.departure)}
        </Item>
        <Item label="Guests">{partyLabel(stay)}</Item>
        {params.map((field) => {
          const value = watch.stayParams[field.key];
          const shown = field.options?.find((o) => o.value === value)?.label ?? String(value);
          return (
            <Item key={field.key} label={field.label}>
              {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : shown}
            </Item>
          );
        })}
      </Group>
      <Group title="Preferences">
        <Item label={`Preferred ${noun.many}`}>
          {watch.unitIds.length ? chosenUnits(watch, units, noun) : `Any ${noun.one}`}
        </Item>
        <Item label="Max price per night">
          {watch.maxPrice ? formatPrice(watch.maxPrice, manifest?.currency) : 'No limit'}
        </Item>
        <Item label="Checks">{intervalLabel(watch.checkIntervalMinutes, manifest)}</Item>
        <Item label="Alerts">
          {watch.allowPartialMatch
            ? 'Also when only some nights are free'
            : 'When the whole stay is free'}
          {watch.notifyOnly ? '; stops after the first alert' : '; keeps checking after alerts'}
        </Item>
        {(manifest?.capabilities.holds || watch.hold || watch.autoHold) && (
          <Item label="Automatic hold">
            {autoHoldLabel(
              watch,
              state,
              noun,
              watch.hold ? timeInZone(new Date(watch.hold.expiresAt), zone, now) : undefined
            )}
          </Item>
        )}
      </Group>
      <Group title="Status">
        <Item label="State">
          <StatusPill {...statusPillFor(state)} />
        </Item>
        <Item label="Last checked">
          {watch.lastCheckedAt ? (
            <span title={timeInZone(new Date(watch.lastCheckedAt), zone, now)}>
              {relativeTime(new Date(watch.lastCheckedAt), now)}
            </span>
          ) : (
            'Not yet'
          )}
        </Item>
        {watch.isActive && watch.nextCheckAt && (state === 'active' || state === 'held') && (
          <Item label="Next check">{timeInZone(new Date(watch.nextCheckAt), zone, now)}</Item>
        )}
        {watch.foundCount > 0 && (
          <Item label="Found">{watch.foundCount === 1 ? 'Once' : `${watch.foundCount} times`}</Item>
        )}
      </Group>
    </div>
  );
}

export default WatchSummary;
