import { useEffect, useRef, useState } from 'react';
import { CreditCard, Timer } from 'lucide-react';
import type { ProviderManifest } from '../../../shared/types/provider.types';
import { useHasPassed } from '../../hooks/useNow';
import { CopyCredentialButton } from '../accounts/CopyCredentialButton';
import { Countdown } from '../Countdown';
import { timeInZone } from '../timeFormat';
import { Button, ConfirmDialog, useAnnounce } from '../ui';
import { cx } from '../ui/cx';

/** Shown when "Pay now" finds the hold gone (`HOLD_EXPIRED`), for a watch's hold or a snipe's. */
export const HOLD_EXPIRED_MESSAGE = 'This hold has expired, so it can no longer be paid for.';

/** Announced when a hold was let go and main gave no message for it. */
const HOLD_ENDED = 'The hold has ended.';

export interface HoldPanelProps {
  /** The held unit as the page names it: "CAMPSITE 02", "Site 12", "A site". */
  unit: string;
  /** When the hold runs out. Without one there is no timer. */
  expiresAt: Date | undefined;
  /**
   * `expiresAt` is the provider's guess: "Held until about 10:42 am", and the timer is named
   * "About 23 minutes left to pay".
   */
  expiresEstimated?: boolean;
  /** The hold's provider: its name in the words, its time zone for the expiry. */
  manifest: ProviderManifest | undefined;
  /** The region's name, unique per hold ("Hold at Bungarra"), so a list has no two alike. */
  label: string;
  /** The place, for "Let it go"'s question: "{unit} at {place} goes back on sale." */
  place?: string;
  /** Opens the provider's payment window (main passes its queue first). */
  onPay: () => void;
  paying: boolean;
  /**
   * "Let it go", beside "Pay now" while the hold has not run out, for a provider that can let a
   * hold go (`manifest.holdRelease`, with its holds on): it asks first, then calls this. Resolves with why the hold
   * ended, which is announced; a rejection keeps the question open with its message.
   */
  onRelease?: () => Promise<string | undefined>;
  /** Why the hold ended before it ran out ("You let it go."), shown once it has. */
  endedMessage?: string;
  /** `page`: the page's one coral button and a line on paying; `card`: quieter, for a list. */
  variant?: 'page' | 'card';
  className?: string;
}

/**
 * A held unit and the time left to pay for it, the same for a watch's automatic hold and a
 * snipe's: "CAMPSITE 02 is held for you · Held until 10:42 am · 23:10 left", with "Pay now"
 * opening the provider's payment window on the session that holds it, "Copy {label}" beside it
 * when the person saved a detail the provider's checkout asks for (an RAC member number), and
 * (for a provider that can let a hold go) "Let it go". Once the hold ends the buttons go and its
 * heading says so, with why when it was let go (`endedMessage`). A hold without an expiry shows
 * no timer.
 *
 * Focus: "Let it go" asks in a ConfirmDialog (Cancel first); cancelling returns to "Let it go",
 * and once the hold has ended (let go, or run out while asking) focus goes to the heading.
 */
export function HoldPanel({
  unit,
  expiresAt,
  expiresEstimated = false,
  manifest,
  label,
  place,
  onPay,
  paying,
  onRelease,
  endedMessage,
  variant = 'page',
  className,
}: HoldPanelProps) {
  const ended = useHasPassed(expiresAt);
  const announce = useAnnounce();
  const [confirming, setConfirming] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** The hold was let go here: once it shows as ended, focus goes to its heading. */
  const focusEnded = useRef(false);
  /** Why it ended, said once the panel shows it (or as the panel goes). */
  const toAnnounce = useRef<string | null>(null);
  const endedRef = useRef(ended);
  endedRef.current = ended;
  const provider = manifest?.shortName ?? 'the booking site';
  const page = variant === 'page';
  // `holdRelease` may stand alone with holds off (an experiment not on, or turned off before a
  // restart): then nothing can be let go, and main would answer CAPABILITY
  const canRelease =
    onRelease !== undefined &&
    manifest?.holdRelease === true &&
    manifest.capabilities.holds === true;
  const Heading = page ? 'h2' : 'h3';
  const frame = cx(
    'flex flex-col gap-3 rounded-lg border p-4',
    ended ? 'border-border bg-surface-subtle' : 'border-warning-fg/30 bg-warning-subtle',
    className
  );

  // The hold ended while it was being let go, or while the question was open: the buttons are
  // gone, so focus goes to the heading that says so, and why it ended is said. After this
  // commit's other effects (a page's own status announcement), so it is what is heard last.
  useEffect(() => {
    if (!ended) return;
    if (confirming) {
      focusEnded.current = true;
      setConfirming(false);
    }
    if (focusEnded.current) {
      focusEnded.current = false;
      headingRef.current?.focus();
    }
    const message = toAnnounce.current;
    if (message !== null) {
      toAnnounce.current = null;
      queueMicrotask(() => announce(message));
    }
  }, [ended, confirming, announce]);

  // A panel that goes before it showed the ended hold still says why
  useEffect(
    () => () => {
      if (toAnnounce.current !== null) announce(toAnnounce.current);
    },
    [announce]
  );

  const release = async () => {
    const message = (await onRelease!()) || HOLD_ENDED;
    if (endedRef.current) {
      announce(message);
    } else {
      toAnnounce.current = message;
      focusEnded.current = true;
    }
    setConfirming(false);
  };

  const zone = manifest?.timezone ?? 'Australia/Perth';
  const about = expiresEstimated ? 'about ' : '';
  const content = ended ? (
    <>
      <Heading
        ref={headingRef}
        tabIndex={-1}
        className="text-sm font-semibold text-fg focus:outline-hidden"
      >
        {endedMessage ? 'The hold has ended' : 'The hold has expired'}
      </Heading>
      <p className="text-sm text-fg-secondary">
        {endedMessage ??
          `The hold on ${unit} ran out before it was paid for, so ${provider} has released it.`}
      </p>
    </>
  ) : (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex items-center gap-2 text-base font-semibold text-warning-fg">
            <Timer size={18} aria-hidden="true" />
            {unit} is held for you
          </p>
          {expiresAt ? (
            <p className="text-sm text-warning-fg">
              Held until {about}
              {timeInZone(expiresAt, zone)} ·{' '}
              <Countdown
                to={expiresAt}
                label={(left) =>
                  expiresEstimated ? `About ${left} left to pay` : `${left} left to pay`
                }
                className="font-semibold"
              />{' '}
              <span aria-hidden="true">left</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canRelease && (
            <Button variant={page ? 'secondary' : 'ghost'} onClick={() => setConfirming(true)}>
              Let it go
            </Button>
          )}
          {/* The card's strongest action, below the page's one coral button (the detail page's). */}
          <Button
            variant={page ? 'primary' : 'secondary'}
            leadingIcon={<CreditCard size={18} />}
            onClick={onPay}
            loading={paying}
          >
            Pay now
          </Button>
          <CopyCredentialButton providerId={manifest?.id} />
        </div>
      </div>
      {page && (
        <p className="text-sm text-fg-secondary">
          Pay on {provider} before the hold runs out. The payment page opens in its own window,
          where {provider} may ask you to sign in.
        </p>
      )}
    </>
  );

  return (
    <>
      <section aria-label={label} className={frame}>
        {content}
      </section>
      {canRelease && (
        <ConfirmDialog
          open={confirming && !ended}
          title="Let this hold go?"
          message={`${place ? `${unit} at ${place}` : unit} goes back on sale. You can't undo this.`}
          confirmLabel="Let it go"
          tone="danger"
          onConfirm={release}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

export default HoldPanel;
