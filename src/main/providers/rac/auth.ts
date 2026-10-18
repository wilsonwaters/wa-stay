/**
 * RAC's account: the person's own RAC member number, saved in Settings → Accounts (a
 * `credentials` sign-in; terms rules 11 and 12, decision RS13). It is optional (`account:
 * 'optional'`): without it WA Stay shows public prices and public release times, and with it
 * members' rates and the member pre-sale (rule 14, `membership.ts`).
 *
 * - **One field**, `memberNumber`: secret (masked as it is typed) and copyable, so "Copy RAC
 *   member number" puts it on the clipboard from main for the person to paste at RAC's own
 *   checkout. WA Stay never types it anywhere.
 * - **Three statements** the person ticks (booking policy 8.3–8.5): their own number, they will
 *   stay, and they will book in the name on the card.
 * - **`signIn` checks the format only, and sends nothing** (rule 12: RAC offers no check
 *   without signing in, and the app never tries a number). Spaces and hyphens are ignored (RAC's
 *   checkout strips `-`), then 4 to 16 digits and nothing else are required (RS13). It answers
 *   the digits as the value to store, so a typed "1234 5678" is kept and copied as "12345678",
 *   and a leading zero stays: the number is text from end to end, never a `Number`. Anything
 *   else is refused with "That doesn't look like an RAC member number", which quotes nothing.
 * - **`isSignedIn`**: signed in while a number is saved (`membership.ts`), signed out while none
 *   is, and `unknown` when the saved one can't be read (it cannot tell, so never signed out). No
 *   request. (The core works a `credentials` account's status out itself, counting an
 *   unreadable value as not saved, and never calls it.)
 *
 * Neither function logs, and neither puts what was typed in an answer other than the digits to
 * store. Neither sends a request, so a save never waits in RAC's paced queue (10 s between
 * requests): the core's 15 s limit on `signIn` (`probeTimeoutMs`) needs nothing more for RAC.
 */

import type { ProviderContext } from '../sdk/context';
import { throwIfAborted } from '../sdk/errors';
import type { CredentialsAuth } from '../sdk/provider';
import { memberNumberState } from './membership';

/** The field's key: the core keeps the value as `account.memberNumber`. */
export const RAC_MEMBER_NUMBER_FIELD = 'memberNumber';

/** Why a number is refused: the same words whatever was typed, quoting none of it. */
export const RAC_MEMBER_NUMBER_REFUSED = "That doesn't look like an RAC member number";

/** Digits only, 4 to 16 of them, once spaces and hyphens are removed (RS13). */
const MEMBER_NUMBER = /^\d{4,16}$/;

/**
 * The member number as RAC's checkout takes it: the digits of `typed` with its spaces and
 * hyphens removed, or undefined when what is left is not 4 to 16 digits. Text throughout.
 */
export function normaliseMemberNumber(typed: string): string | undefined {
  const digits = typed.replace(/[\s-]/g, '');
  return MEMBER_NUMBER.test(digits) ? digits : undefined;
}

export function createRacAuth(ctx: Pick<ProviderContext, 'secrets' | 'logger'>): CredentialsAuth {
  return {
    kind: 'credentials',
    fields: [
      {
        key: RAC_MEMBER_NUMBER_FIELD,
        label: 'RAC member number',
        help:
          'On your RAC card or in myRAC. Kept encrypted on this computer and never sent. ' +
          "You type it at RAC's checkout.",
        secret: true,
        copyable: true,
      },
    ],
    confirmations: [
      { key: 'ownNumber', label: 'This is my own RAC member number' },
      { key: 'willStay', label: 'I will stay at the park myself' },
      { key: 'nameOnCard', label: 'I will book in the name on my RAC card' },
    ],
    // A local check: no request, so `http` is never used
    async signIn(values, _http, signal) {
      throwIfAborted(signal);
      const digits = normaliseMemberNumber(values[RAC_MEMBER_NUMBER_FIELD] ?? '');
      if (digits === undefined) return { state: 'signed-out', message: RAC_MEMBER_NUMBER_REFUSED };
      return { state: 'signed-in', values: { [RAC_MEMBER_NUMBER_FIELD]: digits } };
    },
    async isSignedIn(_http, signal) {
      throwIfAborted(signal);
      const state = await memberNumberState(ctx);
      if (state === 'unreadable') return { state: 'unknown', reason: 'unreadable' };
      return { state: state === 'saved' ? 'signed-in' : 'signed-out' };
    },
  };
}
