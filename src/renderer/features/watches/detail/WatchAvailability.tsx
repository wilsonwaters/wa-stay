import { WatchResult } from '../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { Watch } from '../../../../shared/types/watch.types';
import { NightGrid } from '../../../components/NightGrid';
import { relativeTime, timeInZone } from '../../../components/timeFormat';
import { resultSummary } from '../shared/resultSummary';
import { unitNounFor } from '../shared/watchState';

export interface WatchAvailabilityProps {
  watch: Watch;
  manifest: ProviderManifest | undefined;
  now: Date;
}

/**
 * What the watch's last check saw, night by night (E2's NightGrid: nights only, honest about
 * nights not released or not reported), with when it was checked.
 */
export function WatchAvailability({ watch, manifest, now }: WatchAvailabilityProps) {
  const noun = unitNounFor(manifest);
  const units = watch.lastAvailability;
  const checked = watch.lastCheckedAt ? new Date(watch.lastCheckedAt) : undefined;
  const when = checked && (
    <p className="text-sm text-fg-secondary">
      From the check {relativeTime(checked, now)}
      {manifest && ` (${timeInZone(checked, manifest.timezone, now)})`}:{' '}
      <span className="font-semibold text-fg">{resultSummary(watch, noun)}</span>
    </p>
  );

  let body;
  if (!units) {
    body = (
      <p className="text-base text-fg-secondary">
        {checked
          ? `The last check has no ${noun.one} details.`
          : 'No check yet. Use Check now to see availability.'}
      </p>
    );
  } else if (units.length === 0) {
    body = (
      <p className="text-base text-fg-secondary">
        {watch.unitIds.length
          ? `None of the chosen ${noun.many} were in the last check.`
          : `The last check listed no ${noun.many}.`}
      </p>
    );
  } else {
    body = (
      <NightGrid
        units={units}
        arrival={watch.stay.arrival}
        departure={watch.stay.departure}
        unitNoun={noun}
        currency={manifest?.currency}
        source={manifest?.shortName}
        // A watch that found only some nights (or looks for them) shows them at once.
        fullyAvailableOnly={
          watch.lastResult !== WatchResult.PARTIAL_FOUND && !watch.allowPartialMatch
        }
      />
    );
  }

  return (
    <section aria-labelledby="availability-heading" className="flex min-w-0 flex-col gap-3">
      <h2 id="availability-heading" className="text-xl font-semibold text-fg">
        Availability
      </h2>
      {when}
      {body}
    </section>
  );
}

export default WatchAvailability;
