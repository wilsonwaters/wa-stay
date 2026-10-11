/**
 * `accounts`: the person's account with each provider, signed in on the provider's own
 * pages in an app window. Changes arrive as `account:updated` events.
 *
 * The handlers answer `NOT_IMPLEMENTED` until the account service lands (V6); the request
 * schemas are already enforced.
 */

import { z } from 'zod';
import { ProviderIdSchema, type ProviderAccount, type ProviderId } from '../types/provider.types';
import { assertTypeEquals } from '../utils/type-equality';
import { CHANNELS } from './channels';
import type { Namespace } from './define';

const C = CHANNELS.accounts;

/** The payload of `status`, `signIn` and `signOut`. */
export interface AccountRequest {
  providerId: ProviderId;
}

/** The `accounts.openSignInLink` payload. */
export interface OpenSignInLinkRequest {
  providerId: ProviderId;
  /** An https link the person pasted. */
  url: string;
}

const providerPayload = z.object({ providerId: ProviderIdSchema });
const openSignInLinkRequest = z.object({
  providerId: ProviderIdSchema,
  url: z.url().refine((url) => url.startsWith('https://'), 'Sign-in links must be https'),
});
assertTypeEquals<z.input<typeof providerPayload>, AccountRequest>(true);
assertTypeEquals<z.output<typeof providerPayload>, AccountRequest>(true);
assertTypeEquals<z.input<typeof openSignInLinkRequest>, OpenSignInLinkRequest>(true);
assertTypeEquals<z.output<typeof openSignInLinkRequest>, OpenSignInLinkRequest>(true);

export const accounts = {
  /** An account for every provider that has sign-in. */
  list: { channel: C.list, request: z.void(), args: {} as [], response: {} as ProviderAccount[] },
  /** Asks the provider whether the session is signed in. */
  status: {
    channel: C.status,
    request: providerPayload,
    args: {} as [providerId: ProviderId],
    response: {} as ProviderAccount,
  },
  /** Opens the sign-in window; resolves when sign-in finishes or the window is closed. */
  signIn: {
    channel: C.signIn,
    request: providerPayload,
    args: {} as [providerId: ProviderId],
    response: {} as ProviderAccount,
  },
  signOut: {
    channel: C.signOut,
    request: providerPayload,
    args: {} as [providerId: ProviderId],
    response: {} as ProviderAccount,
  },
  /**
   * Loads a sign-in link the person pasted (e.g. from an email) in the sign-in window. Main
   * also checks the link is on one of the provider's sign-in origins.
   */
  openSignInLink: {
    channel: C.openSignInLink,
    request: openSignInLinkRequest,
    args: {} as [providerId: ProviderId, url: string],
    response: undefined as void,
  },
} satisfies Namespace;
