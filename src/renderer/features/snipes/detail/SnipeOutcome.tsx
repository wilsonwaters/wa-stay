import { Link } from 'react-router';
import { SnipeStatus } from '../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { ConnectAccountPrompt } from '../../../components/accounts/ConnectAccountPrompt';
import { ROUTES } from '../../../app/routes';
import { Notice } from '../../../components/ui';
import { AlertedPanel } from '../shared/AlertedPanel';
import { HeldPanel } from '../shared/HeldPanel';
import { bookingHref } from '../shared/snipeFormat';
import { isFinished, snipeNoun, timelineSteps } from '../shared/snipeState';
import type { PlaceUnits } from '../shared/usePlaceUnits';
import type { SnipeActions } from '../shared/useSnipeActions';

export interface SnipeOutcomeProps {
  snipe: SiteSnipe;
  manifest: ProviderManifest | undefined;
  actions: SnipeActions;
  units: PlaceUnits;
  /** Today where the provider is, for the stay's dates. */
  today: string;
  now: Date;
}

/**
 * What a snipe has come to, under its page's header: the hold to pay for (or, let go here, how it
 * ended), the alert sent (what was free and "Book on {shortName}"), the booking, an Open Day
 * plan's reminders sent (with "Watch for cancellations" for a stay it didn't get, §12.39), or
 * why it stopped; and, while a snipe that holds runs, the provider's account (a hint where it is
 * optional, §12.32). An alert needs no account.
 */
export function SnipeOutcome({ snipe, manifest, actions, units, today, now }: SnipeOutcomeProps) {
  const provider = manifest?.shortName ?? 'the booking site';
  const terminal = timelineSteps(snipe).find((step) => step.terminal);
  return (
    <>
      {/* Let go here (R18): the hold panel stays, saying how the hold ended */}
      {(snipe.status === SnipeStatus.HELD || actions.letGo) && (
        <HeldPanel snipe={snipe} manifest={manifest} actions={actions} place={units} />
      )}
      {snipe.status === SnipeStatus.ALERTED && (
        <AlertedPanel
          snipe={snipe}
          manifest={manifest}
          actions={actions}
          place={units}
          today={today}
          now={now}
        />
      )}
      {snipe.status === SnipeStatus.BOOKED && (
        <Notice tone="success" title={`Booked on ${provider}`}>
          {snipe.bookedReference && <>Reference {snipe.bookedReference}. </>}
          <Link to={bookingHref(snipe.bookedReference)} className="font-semibold underline">
            See it in Bookings
          </Link>
        </Notice>
      )}
      {snipe.status === SnipeStatus.REMINDED && (
        <Notice tone="success" title="Reminders sent">
          The Open Day has come. Didn&apos;t get it?{' '}
          {manifest?.capabilities.watches ? (
            <>
              <Link
                to={ROUTES.watchNew({
                  provider: snipe.providerId,
                  location: snipe.location.externalId,
                  arrival: snipe.stay.arrival,
                  departure: snipe.stay.departure,
                  adults: snipe.stay.adults,
                  ...(snipe.stay.children ? { children: snipe.stay.children } : {}),
                  ...(snipe.unitKinds.length ? { stay: snipe.unitKinds } : {}),
                })}
                className="font-semibold underline"
              >
                Watch for cancellations
              </Link>
              : a watch checks {provider} and alerts you when the dates come free.
            </>
          ) : (
            <>Look again on {provider} for cancellations.</>
          )}
        </Notice>
      )}
      {terminal && !actions.letGo && (
        <Notice
          tone={snipe.status === SnipeStatus.FAILED ? 'danger' : 'info'}
          title={terminal.label}
        >
          {snipe.lastError ?? 'The snipe has stopped. Arm it again to keep trying.'}
        </Notice>
      )}
      {manifest && snipe.action === 'hold' && !isFinished(snipe) && (
        <ConnectAccountPrompt
          manifest={manifest}
          message={
            manifest.capabilities.account === 'optional'
              ? `Connect ${provider} before the release so checkout is quicker.`
              : `${provider} needs you signed in before Site Sniper can hold a ${snipeNoun(snipe, manifest, units.units).one}.`
          }
        />
      )}
    </>
  );
}

export default SnipeOutcome;
