import { CreditCard, Timer } from 'lucide-react';
import type { ProviderManifest } from '../../../shared/types/provider.types';
import { useHasPassed } from '../../hooks/useNow';
import { Countdown } from '../Countdown';
import { timeInZone } from '../timeFormat';
import { Button } from '../ui';
import { cx } from '../ui/cx';

/** Shown when "Pay now" finds the hold gone (`HOLD_EXPIRED`), for a watch's hold or a snipe's. */
export const HOLD_EXPIRED_MESSAGE = 'This hold has expired, so it can no longer be paid for.';

export interface HoldPanelProps {
  /** The held unit as the page names it: "CAMPSITE 02", "Site 12", "A site". */
  unit: string;
  /** When the hold runs out. Without one there is no timer. */
  expiresAt: Date | undefined;
  /** The hold's provider: its name in the words, its time zone for the expiry. */
  manifest: ProviderManifest | undefined;
  /** The region's name, unique per hold ("Hold at Bungarra"), so a list has no two alike. */
  label: string;
  /** Opens the provider's payment window (main passes its queue first). */
  onPay: () => void;
  paying: boolean;
  /** `page`: the page's one coral button and a line on paying; `card`: quieter, for a list. */
  variant?: 'page' | 'card';
  className?: string;
}

/**
 * A held unit and the time left to pay for it, the same for a watch's automatic hold and a
 * snipe's: "CAMPSITE 02 is held for you · Held until 10:42 am · 23:10 left", with "Pay now"
 * opening the provider's payment window on the session that holds it. Once the hold runs out
 * the button goes and it says so. A hold without an expiry shows no timer.
 */
export function HoldPanel({
  unit,
  expiresAt,
  manifest,
  label,
  onPay,
  paying,
  variant = 'page',
  className,
}: HoldPanelProps) {
  const expired = useHasPassed(expiresAt);
  const provider = manifest?.shortName ?? 'the provider';
  const page = variant === 'page';
  const frame = cx(
    'flex flex-col gap-3 rounded-lg border p-4',
    expired ? 'border-border bg-surface-subtle' : 'border-warning-fg/30 bg-warning-subtle',
    className
  );

  if (expired) {
    return (
      <section aria-label={label} className={frame}>
        <p className="text-sm font-semibold text-fg">The hold has expired</p>
        <p className="text-sm text-fg-secondary">
          The hold on {unit} ran out before it was paid for, so {provider} has released it.
        </p>
      </section>
    );
  }
  return (
    <section aria-label={label} className={frame}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex items-center gap-2 text-base font-semibold text-warning-fg">
            <Timer size={18} aria-hidden="true" />
            {unit} is held for you
          </p>
          {expiresAt ? (
            <p className="text-sm text-warning-fg">
              Held until {timeInZone(expiresAt, manifest?.timezone ?? 'Australia/Perth')} ·{' '}
              <Countdown
                to={expiresAt}
                label={(left) => `${left} left to pay`}
                className="font-semibold"
              />{' '}
              <span aria-hidden="true">left</span>
            </p>
          ) : null}
        </div>
        {/* The card's strongest action, below the page's one coral button (the detail page's). */}
        <Button
          variant={page ? 'primary' : 'secondary'}
          leadingIcon={<CreditCard size={18} />}
          onClick={onPay}
          loading={paying}
        >
          Pay now
        </Button>
      </div>
      {page && (
        <p className="text-sm text-fg-secondary">
          Pay on {provider} before the hold runs out. The payment page opens in its own window,
          where {provider} may ask you to sign in.
        </p>
      )}
    </section>
  );
}

export default HoldPanel;
