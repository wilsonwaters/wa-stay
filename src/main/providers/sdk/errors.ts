/**
 * Provider errors. Everything a provider, the registry or the SDK throws is a
 * `ProviderError` (or an `AbortError` when the caller aborted), so core services and IPC can
 * tell a missing capability from a network failure without parsing messages.
 *
 * `toApiError` maps them to the `{ code, message }` of an `APIResponse` for `ipc/handle.ts`.
 */

import type { AccessState, ProviderId } from '@shared/types/provider.types';
import type { ApiErrorCode } from '@shared/types/api.types';

export type ProviderErrorCode =
  | 'provider'
  | 'capability'
  | 'unknown-provider'
  | 'registration'
  | 'http'
  | 'timeout'
  | 'parse'
  | 'auth-required'
  | 'access-gate'
  | 'browser-unavailable';

export interface ProviderErrorOptions {
  providerId: ProviderId;
  message: string;
  code?: ProviderErrorCode;
  /** Whether trying again later could succeed (logged; never shown to the user). */
  retryable?: boolean;
  cause?: unknown;
}

export class ProviderError extends Error {
  readonly providerId: ProviderId;
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;

  constructor({
    providerId,
    message,
    code = 'provider',
    retryable = false,
    cause,
  }: ProviderErrorOptions) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ProviderError';
    this.providerId = providerId;
    this.code = code;
    this.retryable = retryable;
  }
}

/** The provider does not have the capability (or module) a caller asked for. */
export class ProviderCapabilityError extends ProviderError {
  readonly capability: string;

  constructor(providerId: ProviderId, capability: string) {
    super({
      providerId,
      code: 'capability',
      message: `${providerId} does not support ${capability}`,
    });
    this.name = 'ProviderCapabilityError';
    this.capability = capability;
  }
}

export class UnknownProviderError extends ProviderError {
  constructor(providerId: ProviderId) {
    super({ providerId, code: 'unknown-provider', message: `Unknown provider "${providerId}"` });
    this.name = 'UnknownProviderError';
  }
}

/** A provider could not be registered: bad id, duplicate, invalid manifest, or its factory threw. */
export class ProviderRegistrationError extends ProviderError {
  constructor(providerId: ProviderId, reason: string, cause?: unknown) {
    super({
      providerId,
      code: 'registration',
      message: `Provider "${providerId}" could not be registered: ${reason}`,
      cause,
    });
    this.name = 'ProviderRegistrationError';
  }
}

/** Drops the query string, which can carry personal details, from a URL shown in a message. */
function withoutQuery(url: string): string {
  const at = url.search(/[?#]/);
  return at < 0 ? url : url.slice(0, at);
}

/**
 * Why an HTTP request failed:
 * - `status`: a non-2xx response (from `getJson`/`postForm`); retryable for 408, 429 and 5xx;
 * - `redirect`: a redirect under `redirect: 'error'`;
 * - `redirect-limit`: more than `MAX_REDIRECTS` redirects (a loop);
 * - `network`: no response for a reason that can pass (connection refused or reset, DNS,
 *   offline, proxy); retryable;
 * - `blocked`: the request was refused before or instead of a response, and trying again
 *   will not help (a URL that is not https, a blocked or unsafe request, a bad certificate).
 */
export type HttpErrorReason = 'status' | 'redirect' | 'redirect-limit' | 'network' | 'blocked';

const RETRYABLE_STATUS = (status: number): boolean =>
  status === 408 || status === 429 || status >= 500;

/**
 * An HTTP failure: a non-2xx response, a redirect the request does not allow, or no response
 * at all. `status` is the response status, or 0 when there was no response; `reason` says
 * which, and `netError` names the transport's error code (`ERR_CONNECTION_REFUSED`,
 * `ECONNRESET`) when there is one.
 */
export class ProviderHttpError extends ProviderError {
  readonly status: number;
  readonly url: string;
  readonly reason: HttpErrorReason;
  readonly netError?: string;

  constructor(options: {
    providerId: ProviderId;
    status: number;
    url: string;
    /** Defaults to `network` for status 0, otherwise `status`. */
    reason?: HttpErrorReason;
    netError?: string;
    message?: string;
    /** Defaults from `reason` (and the status): only `network` and 408/429/5xx retry. */
    retryable?: boolean;
    cause?: unknown;
  }) {
    const { providerId, status, url, netError, cause } = options;
    const reason = options.reason ?? (status === 0 ? 'network' : 'status');
    const detail = netError ? ` (${netError})` : '';
    const defaultMessage =
      reason === 'blocked'
        ? `${providerId}: the request to ${withoutQuery(url)} was blocked${detail}`
        : status === 0
          ? `${providerId}: no response from ${withoutQuery(url)}${detail}`
          : `${providerId}: HTTP ${status} from ${withoutQuery(url)}`;
    super({
      providerId,
      code: 'http',
      message: options.message ?? defaultMessage,
      retryable:
        options.retryable ??
        (reason === 'network' || (reason === 'status' && RETRYABLE_STATUS(status))),
      cause,
    });
    this.name = 'ProviderHttpError';
    this.status = status;
    this.url = url;
    this.reason = reason;
    this.netError = netError;
  }
}

export class ProviderTimeoutError extends ProviderError {
  readonly url: string;
  readonly timeoutMs: number;

  constructor(options: {
    providerId: ProviderId;
    url: string;
    timeoutMs: number;
    cause?: unknown;
  }) {
    const { providerId, url, timeoutMs, cause } = options;
    super({
      providerId,
      code: 'timeout',
      message: `${providerId}: no answer from ${withoutQuery(url)} within ${timeoutMs} ms`,
      retryable: true,
      cause,
    });
    this.name = 'ProviderTimeoutError';
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

/** The provider answered with something the client cannot read (not JSON, wrong shape). */
export class ProviderParseError extends ProviderError {
  readonly url?: string;

  constructor(options: { providerId: ProviderId; message: string; url?: string; cause?: unknown }) {
    super({
      providerId: options.providerId,
      code: 'parse',
      message: options.message,
      cause: options.cause,
    });
    this.name = 'ProviderParseError';
    this.url = options.url;
  }
}

export class ProviderAuthRequiredError extends ProviderError {
  constructor(providerId: ProviderId, message = `Sign in to ${providerId} first`) {
    super({ providerId, code: 'auth-required', message });
    this.name = 'ProviderAuthRequiredError';
  }
}

/** The provider's waiting room or queue is in the way (or failed). */
export class AccessGateError extends ProviderError {
  readonly state: AccessState;

  constructor(providerId: ProviderId, state: AccessState, message?: string) {
    super({
      providerId,
      code: 'access-gate',
      message: message ?? `${providerId}: the queue is ${state}`,
      retryable: state === 'waiting' || state === 'expired',
    });
    this.name = 'AccessGateError';
    this.state = state;
  }
}

/**
 * Why browser automation cannot run:
 * - `runtime-missing`: `playwright-core` could not be loaded;
 * - `no-browser`: neither Microsoft Edge nor Google Chrome is installed;
 * - `profile-locked`: another browser process holds the provider's profile;
 * - `launch-failed`: the browser was found but did not start; retryable;
 * - `closing`: the app is quitting, so no browser is launched.
 */
export type BrowserUnavailableReason =
  'runtime-missing' | 'no-browser' | 'profile-locked' | 'launch-failed' | 'closing';

export class BrowserUnavailableError extends ProviderError {
  readonly reason: BrowserUnavailableReason;

  constructor(
    providerId: ProviderId,
    reason: BrowserUnavailableReason,
    message?: string,
    cause?: unknown
  ) {
    super({
      providerId,
      code: 'browser-unavailable',
      message: message ?? `${providerId}: browser automation is not available (${reason})`,
      retryable: reason === 'launch-failed' || reason === 'profile-locked',
      cause,
    });
    this.name = 'BrowserUnavailableError';
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------------------

/** True for the error an aborted operation rejects with (a DOMException or Error named AbortError). */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/** The `AbortError` to reject with: the signal's own reason when it is one, otherwise a new one. */
export function createAbortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  // Checked by name, not `instanceof`: a DOMException can come from another realm.
  if (isAbortError(reason)) return reason as Error;
  return new DOMException('The operation was aborted', 'AbortError');
}

/** Throws an `AbortError` if `signal` is already aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError(signal);
}

// ---------------------------------------------------------------------------------------
// IPC mapping
// ---------------------------------------------------------------------------------------

export interface ApiError {
  code: ApiErrorCode;
  message: string;
}

/** Maps a provider error to an `APIResponse` code and message. Anything else is `INTERNAL`. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ProviderCapabilityError)
    return { code: 'CAPABILITY', message: error.message };
  if (error instanceof UnknownProviderError) {
    return { code: 'UNKNOWN_PROVIDER', message: error.message };
  }
  if (error instanceof AccessGateError) return { code: 'ACCESS_GATE', message: error.message };
  if (error instanceof ProviderHttpError && error.status === 429) {
    return { code: 'RATE_LIMITED', message: error.message };
  }
  if (error instanceof ProviderAuthRequiredError) {
    return { code: 'AUTH_REQUIRED', message: error.message };
  }
  if (error instanceof ProviderRegistrationError)
    return { code: 'INTERNAL', message: error.message };
  if (error instanceof ProviderError) return { code: 'PROVIDER_ERROR', message: error.message };
  const message = error instanceof Error && error.message ? error.message : 'Unexpected error';
  return { code: 'INTERNAL', message };
}
