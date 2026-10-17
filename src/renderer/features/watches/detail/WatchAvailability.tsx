import { WatchResult } from '../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { Watch } from '../../../../shared/types/watch.types';
import { ExternalLink } from '../../../components/ExternalLink';
import { NightGrid } from '../../../components/NightGrid';
import { stayRangeLabel } from '../../../components/nightGridModel';
import { providerToday } from '../../../components/stay/providerToday';
import { relativeTime, timeInZone } from '../../../components/timeFormat';
import { resultSummary } from '../shared/resultSummary';
import { watchNoun } from '../shared/watchState';

export interface WatchAvailabilityProps {
  watch: Watch;
  manifest: ProviderManifest | undefined;
  now: Date;
}

/**
 * What the watch's last check saw, night by night (E2's NightGrid: nights only, honest about
 * nights not released or not reported), with when it was checked. When the check found a
 * stay and it has not begun, "Book on {shortName}" opens the provider's booking page for it
 * in the browser, right after the result line (with a partial match's dates).
 */
export function WatchAvailability({ watch, manifest, now }: WatchAvailabilityProps) {
  const noun = watchNoun(watch, manifest);
  const units = watch.lastAvailability;
  const checked = watch.lastCheckedAt ? new Date(watch.lastCheckedAt) : undefined;
  const when = checked && (
    <p className="text-sm text-fg-secondary">
      From the check {relativeTime(checked, now)}
      {manifest && ` (${timeInZone(checked, manifest.timezone, now)})`}:{' '}
      <span className="font-semibold text-fg">{resultSummary(watch, noun)}</span>
    </p>
  );

  // Main sets the link only for a found or partly found stay (never a held one: that is paid
  // for in the app); the page hides it once the stay has begun where the provider is
  const partialStay = watch.lastResult === WatchResult.PARTIAL_FOUND;
  const link =
    watch.bookingLink &&
    (watch.lastResult === WatchResult.FOUND || partialStay) &&
    providerToday(manifest, now) < watch.stay.arrival
      ? watch.bookingLink
      : undefined;
  const book = link && (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <ExternalLink href={link.url} variant="primary">
        Book on {manifest?.shortName ?? "the provider's website"}
      </ExternalLink>
      {partialStay && (
        <span className="text-sm text-fg-secondary">
          For {stayRangeLabel(link.arrival, link.departure)}
        </span>
      )}
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
      {book}
      {body}
    </section>
  );
}

export default WatchAvailability;
