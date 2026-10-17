/**
 * `accounts`: the person's account with each provider, signed in on the provider's own
 * pages in an app window (`browser-session`), or with details saved in the app
 * (`credentials`). Changes arrive as `account:updated` events.
 *
 * A `credentials` value is write-only, like the SMTP password: `saveCredentials` sends it to
 * main, and nothing ever sends it back (an account lists `savedFields`, key names only).
 * `copyCredential` asks main to put a saved value on the clipboard.
 */

import { z } from 'zod';
import {
  AccountKeySchema,
  ProviderIdSchema,
  type ProviderAccount,
  type ProviderId,
} from '../types/provider.types';
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

/** The `accounts.saveCredentials` payload. */
export interface SaveCredentialsRequest {
  providerId: ProviderId;
  /** Field key → the value typed. Main trims and checks them; it never sends them back. */
  values: Record<string, string>;
  /** The keys of the statements the person ticked. */
  confirmed: string[];
}

/** The `accounts.copyCredential` payload. */
export interface CopyCredentialRequest {
  providerId: ProviderId;
  /** A `copyable` field's key. */
  key: string;
}

const providerPayload = z.object({ providerId: ProviderIdSchema });
const openSignInLinkRequest = z.object({
  providerId: ProviderIdSchema,
  url: z.url().refine((url) => url.startsWith('https://'), 'Sign-in links must be https'),
});
/** Generous bounds on a payload; the account service checks the real rules (256 characters). */
export const CREDENTIALS_PAYLOAD_LIMITS = Object.freeze({
  keyLength: 64,
  valueLength: 1024,
  values: 16,
  confirmed: 16,
});
const L = CREDENTIALS_PAYLOAD_LIMITS;
const credentialKey = AccountKeySchema.max(L.keyLength);
// A refusal here is answered by handle() with its issue paths only (`values.memberNumber`),
// never zod's messages, so nothing typed is quoted. The account service then checks every
// value: trimmed, declared, not empty, at most 256 characters.
const saveCredentialsRequest = z.object({
  providerId: ProviderIdSchema,
  values: z
    .record(credentialKey, z.string().max(L.valueLength))
    .refine((values) => Object.keys(values).length <= L.values, `At most ${L.values} values`),
  confirmed: z.array(credentialKey).max(L.confirmed),
});
const copyCredentialRequest = z.object({ providerId: ProviderIdSchema, key: credentialKey });
assertTypeEquals<z.input<typeof providerPayload>, AccountRequest>(true);
assertTypeEquals<z.output<typeof providerPayload>, AccountRequest>(true);
assertTypeEquals<z.input<typeof openSignInLinkRequest>, OpenSignInLinkRequest>(true);
assertTypeEquals<z.output<typeof openSignInLinkRequest>, OpenSignInLinkRequest>(true);
assertTypeEquals<z.input<typeof saveCredentialsRequest>, SaveCredentialsRequest>(true);
assertTypeEquals<z.output<typeof saveCredentialsRequest>, SaveCredentialsRequest>(true);
assertTypeEquals<z.input<typeof copyCredentialRequest>, CopyCredentialRequest>(true);
assertTypeEquals<z.output<typeof copyCredentialRequest>, CopyCredentialRequest>(true);

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
  /** Signs out; for a `credentials` account, removes the saved details. */
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
  /**
   * Saves a `credentials` account's details (write-only), once every statement is ticked and
   * the provider accepts them. Saving again replaces them.
   */
  saveCredentials: {
    channel: C.saveCredentials,
    request: saveCredentialsRequest,
    args: {} as [providerId: ProviderId, values: Record<string, string>, confirmed: string[]],
    response: {} as ProviderAccount,
  },
  /** Main puts a saved, copyable value on the clipboard; the renderer never gets it. */
  copyCredential: {
    channel: C.copyCredential,
    request: copyCredentialRequest,
    args: {} as [providerId: ProviderId, key: string],
    response: undefined as void,
  },
} satisfies Namespace;
