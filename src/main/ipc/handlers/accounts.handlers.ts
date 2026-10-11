/**
 * `accounts` handlers: the person's account with each provider (`ProviderAccountService`).
 * Responses carry the account's status, email and name only; never a cookie or token.
 *
 * - `list`: every provider with sign-in, from the stored rows (no network);
 * - `status`: asks the provider (cached for 60 s);
 * - `signIn`: opens the in-app sign-in window and answers when sign-in is confirmed or the
 *   window closes;
 * - `signOut`: `ACCOUNT_BUSY` while a snipe or hold needs the session;
 * - `openSignInLink`: loads a pasted sign-in link, which must be on the provider's sign-in
 *   origins (`VALIDATION` otherwise).
 */

import { contract } from '@shared/contracts';
import type { AppContainer } from '../../app/container';
import type { Handle } from '../handle';

export function registerAccountsHandlers(handle: Handle, c: AppContainer): void {
  const api = contract.accounts;

  handle(api.list, () => c.accounts.list());
  handle(api.status, ({ providerId }) => c.accounts.status(providerId));
  handle(api.signIn, ({ providerId }) => c.accounts.signIn(providerId));
  handle(api.signOut, ({ providerId }) => c.accounts.signOut(providerId));
  handle(api.openSignInLink, ({ providerId, url }) => c.accounts.openSignInLink(providerId, url));
}
