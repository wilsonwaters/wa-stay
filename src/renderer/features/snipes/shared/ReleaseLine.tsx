import { CalendarClock, Clock, Search } from 'lucide-react';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { Countdown } from '../../../components/Countdown';
import { timeInZone } from '../../../components/timeFormat';
import { cx } from '../../../components/ui/cx';
import { useHasPassed } from '../../../hooks/useNow';
import { RELEASE_UNKNOWN } from '../create/releasePreview';
import { releaseLineFor } from './snipeState';

export interface ReleaseLineProps {
  snipe: SiteSnipe;
  manifest: ProviderManifest | undefined;
  className?: string;
}

/**
 * When the snipe's sites are released: a countdown while it runs ("Opens in 1d 2h"; "Opening
 * now" once the time has come, never a negative count), "Watching for cancellations", a paused
 * snipe's release time, or that the time is unknown. Only the countdown ticks.
 */
export function ReleaseLine({ snipe, manifest, className }: ReleaseLineProps) {
  const line = releaseLineFor(snipe);
  const at = line.kind === 'countdown' ? line.at : undefined;
  const opened = useHasPassed(at);
  const zone = manifest?.timezone ?? 'Australia/Perth';
  const classes = cx('flex items-center gap-1.5 text-sm', className);

  switch (line.kind) {
    case 'cancellation':
      return (
        <p className={cx(classes, 'text-fg-secondary')}>
          <Search size={16} aria-hidden="true" />
          Watching for cancellations
        </p>
      );
    case 'countdown':
      return (
        <p className={cx(classes, 'text-fg-secondary')}>
          <Clock size={16} aria-hidden="true" />
          {opened ? (
            'Opening now'
          ) : (
            <>
              <span aria-hidden="true">Opens in</span>
              <Countdown
                to={line.at}
                label={(left) => `Opens in ${left}`}
                className="font-semibold text-fg"
              />
            </>
          )}
        </p>
      );
    case 'scheduled':
      return (
        <p className={cx(classes, 'text-fg-secondary')}>
          <CalendarClock size={16} aria-hidden="true" />
          Release {timeInZone(line.at, zone)}
        </p>
      );
    case 'unknown':
      return <p className={cx(classes, 'text-fg-secondary')}>{RELEASE_UNKNOWN}</p>;
    default:
      return null;
  }
}

export default ReleaseLine;
