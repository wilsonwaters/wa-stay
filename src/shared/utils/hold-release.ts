/**
 * How a hold that ended before it ran out says so (R18): main stores one of these as the row's
 * `lastError` when the provider let the hold go (`released`) or no longer held it (`gone`), and
 * the renderer tells such a hold from one that ran out by it (`holdEndingOf`).
 */

/** The person let it go ("Let it go", or deleting its watch or snipe). */
export const HOLD_RELEASED_MESSAGE = 'You let it go.';

/** Let go when its payment window closed with no confirmed payment. */
export const HOLD_RELEASED_ON_CLOSE_MESSAGE = 'Let go when the payment window closed.';

/**
 * The provider no longer held it: the person may have paid, so it points to the provider's
 * confirmation and never says "booked".
 */
export function holdGoneMessage(shortName: string): string {
  return `${shortName} no longer holds it. If you paid, look for ${shortName}'s confirmation email.`;
}

const GONE = /^.+ no longer holds it\. If you paid, look for .+'s confirmation email\.$/;

/** How a hold ended early, by its message: let go, or gone from the provider. */
export type HoldEnding = 'let-go' | 'gone';

/** How the hold `message` (a row's `lastError`) says it ended early, or undefined. */
export function holdEndingOf(message: string | undefined): HoldEnding | undefined {
  if (message === HOLD_RELEASED_MESSAGE || message === HOLD_RELEASED_ON_CLOSE_MESSAGE) {
    return 'let-go';
  }
  return message !== undefined && GONE.test(message) ? 'gone' : undefined;
}
