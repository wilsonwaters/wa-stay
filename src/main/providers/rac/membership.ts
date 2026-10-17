/**
 * Whether the person has saved an RAC member number (terms rules 11, 12 and 14), as a boolean
 * and nothing more. The number itself is the person's: Settings → Accounts saves it through
 * RAC's `credentials` sign-in (`auth.ts`), and the core keeps it encrypted in RAC's scoped
 * secret vault as `account.memberNumber`. This file is the only RAC module that reads it, and
 * it reads only whether it is there: no RAC module ever has the number, so none can log it,
 * put it in an error or send it (a source guard checks that no other RAC file names the key).
 *
 * - `hasMemberNumber(ctx)`: true when a number is saved. A secret that cannot be read (the
 *   data was copied to another computer, `SecretUnreadableError`, or any other failure) counts
 *   as no number, with a warning that names the error's kind only, never a value.
 *   `memberNumberState(ctx)` tells that case apart (`unreadable`), for `isSignedIn`.
 * - `createMembership(isMember, logger)`: what the modules share. `read()` asks `isMember()`
 *   (false, with a warning, when it fails) and remembers the answer; `last()` is that answer,
 *   for the one synchronous reader, `links.booking`'s `membership_type`. Nothing else caches it:
 *   every check, bulk search and release compute asks again, so a number saved or removed shows
 *   at the next one.
 */

import type { ProviderContext, ProviderLogger } from '../sdk/context';

/** The saved number's key in RAC's scoped secret vault (`account.<field key>`, R15). */
export const RAC_MEMBER_NUMBER_SECRET = 'account.memberNumber';

/** The error's kind, never its message: a message could quote what it was reading. */
function kindOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Whether a member number is saved: `saved`, `none`, or `unreadable` (a warning names the
 * error's kind, never a value). Never the number.
 */
export async function memberNumberState(
  ctx: Pick<ProviderContext, 'secrets' | 'logger'>
): Promise<'saved' | 'none' | 'unreadable'> {
  try {
    const saved = await ctx.secrets.get(RAC_MEMBER_NUMBER_SECRET);
    return typeof saved === 'string' && saved.length > 0 ? 'saved' : 'none';
  } catch (error) {
    ctx.logger.warn(
      `RAC: the saved member number can't be read (${kindOf(error)}); public prices and release times`
    );
    return 'unreadable';
  }
}

/** Whether a member number is saved; false, with a warning naming no value, when unreadable. */
export async function hasMemberNumber(
  ctx: Pick<ProviderContext, 'secrets' | 'logger'>
): Promise<boolean> {
  return (await memberNumberState(ctx)) === 'saved';
}

export interface RacMembership {
  /** Asks whether a member number is saved, now; false (with a warning) when it can't tell. */
  read(): Promise<boolean>;
  /** The last answer `read()` gave; false before the first. */
  last(): boolean;
}

export function createMembership(
  isMember: () => Promise<boolean>,
  logger?: Pick<ProviderLogger, 'warn'>
): RacMembership {
  let known = false;
  return {
    async read() {
      let member = false;
      try {
        member = (await isMember()) === true;
      } catch (error) {
        logger?.warn(
          `RAC: could not tell whether a member number is saved (${kindOf(error)}); public prices and release times`
        );
      }
      known = member;
      return member;
    },
    last: () => known,
  };
}
