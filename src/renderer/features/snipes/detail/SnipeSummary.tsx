import type { ReactNode } from 'react';
import { SnipeReleaseMode, SnipeStatus } from '../../../../shared/types/common.types';
import type { UnitSummary } from '../../../../shared/types/catalog.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { partyLabel, stayDatesLabel, stayNightsLabel } from '../../../components/stay/stayFormat';
import { relativeTime } from '../../../components/timeFormat';
import { msToMinutes, msToSeconds } from '../create/snipeFormMapping';
import { releaseText, stayFieldText } from '../shared/snipeFormat';
import { unitLabel, unitNounFor } from '../shared/snipeState';

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = `snipe-summary-${title.toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-lg font-semibold text-fg">
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

export interface SnipeSummaryProps {
  snipe: SiteSnipe;
  manifest: ProviderManifest | undefined;
  today: string;
  now: Date;
  /** The place's units (its catalogue detail), for the chosen units' names. */
  units?: readonly UnitSummary[];
}

/** The snipe's stay, and its release and timing, side by side. */
export function SnipeSummary({ snipe, manifest, today, now, units }: SnipeSummaryProps) {
  const { stay } = snipe;
  const noun = unitNounFor(manifest);
  const names = new Map((units ?? []).map((u) => [u.unitId, u.unitName]));
  const fields = (manifest?.stayFields ?? []).filter((f) => snipe.stayParams[f.key] !== undefined);
  const continuous = snipe.releaseMode === SnipeReleaseMode.CANCELLATION;
  const releaseAt = snipe.releaseAt ? new Date(snipe.releaseAt) : undefined;

  return (
    <div className="grid gap-8 sm:grid-cols-2">
      <Group title="Stay">
        <Item label="Dates">
          {stayDatesLabel(stay.arrival, stay.departure, today)} ·{' '}
          {stayNightsLabel(stay.arrival, stay.departure)}
        </Item>
        <Item label="Guests">{partyLabel(stay)}</Item>
        {fields.map((field) => (
          <Item key={field.key} label={field.label}>
            {stayFieldText(field, snipe.stayParams[field.key])}
          </Item>
        ))}
        <Item label={`Preferred ${noun.many}`}>
          {snipe.unitIds.length
            ? snipe.unitIds.map((id) => unitLabel(id, noun, names)).join(', ')
            : `Any ${noun.one}`}
        </Item>
      </Group>
      <Group title="Release">
        <Item label="When">{releaseText(manifest, snipe.releaseMode, releaseAt, now)}</Item>
        {!continuous && <Item label="Starts early">{snipe.leadTimeSeconds} seconds before</Item>}
        <Item label="Checks">Every {msToSeconds(snipe.pollIntervalMs)} seconds</Item>
        {!continuous && (
          <Item label="Keeps trying">For {msToMinutes(snipe.windowDurationMs)} minutes</Item>
        )}
        <Item label="Most attempts">{snipe.maxAttempts > 0 ? snipe.maxAttempts : 'No limit'}</Item>
        {manifest?.capabilities.accessGate && (
          <Item label="Queue">
            {snipe.accessGateEnabled ? `Uses the ${manifest.shortName} queue` : 'Not used'}
          </Item>
        )}
      </Group>
    </div>
  );
}

export default SnipeSummary;

/** The snipe's record so far, under its progress: attempts, the last try, and re-arming. */
export function SnipeRecord({ snipe, manifest, now }: Omit<SnipeSummaryProps, 'today' | 'units'>) {
  const noun = unitNounFor(manifest);
  const finished = snipe.status === SnipeStatus.HELD || snipe.status === SnipeStatus.BOOKED;
  return (
    <dl className="flex flex-col gap-2 text-sm">
      <Item label="Attempts">{snipe.attemptsCount}</Item>
      <Item label="Last tried">
        {snipe.lastCheckedAt ? relativeTime(new Date(snipe.lastCheckedAt), now) : 'Not yet'}
      </Item>
      {finished && (
        <Item label="Arming again">
          {`A snipe that has ${snipe.status === SnipeStatus.HELD ? 'held' : 'booked'} a ${noun.one} can't be armed again. To look again, delete it and create a new snipe.`}
        </Item>
      )}
    </dl>
  );
}
