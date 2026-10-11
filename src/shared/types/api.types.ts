// Types for the main ↔ renderer API.

/**
 * Why an IPC call failed. Set on every `success: false` response from `ipc/handle.ts`.
 * - VALIDATION: the request payload failed its contract schema (or a service rule); `issues` lists the paths.
 * - FORBIDDEN: the sender is not the app's own top-level renderer frame.
 * - NO_PROFILE: there is no local profile row to act for.
 * - NOT_FOUND: the record the request names does not exist.
 * - CONFLICT: the record already exists (a booking reference already stored for that provider).
 * - INTERNAL: anything else; `error` carries the thrown message.
 *
 * Provider errors (`main/providers/sdk/errors.ts` `toApiError`):
 * - CAPABILITY: the provider does not offer what the request needs (e.g. holds).
 * - UNKNOWN_PROVIDER: no provider is registered with that id.
 * - PROVIDER_ERROR: the provider failed (HTTP error, timeout, unreadable response).
 * - ACCESS_GATE: the provider's waiting room or queue is in the way.
 * - AUTH_REQUIRED: sign in to the provider first.
 * - NOT_IMPLEMENTED: the method is in the contract but its service has not landed yet
 *   (`catalog` and `accounts` until their services are built).
 */
export type ApiErrorCode =
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'NO_PROFILE'
  | 'NOT_FOUND'
  /** The record already exists, e.g. a booking with that provider's reference. */
  | 'CONFLICT'
  | 'INTERNAL'
  | 'CAPABILITY'
  | 'UNKNOWN_PROVIDER'
  | 'PROVIDER_ERROR'
  | 'ACCESS_GATE'
  /** The provider answered "too many requests" (HTTP 429): try again later, not at once. */
  | 'RATE_LIMITED'
  | 'AUTH_REQUIRED'
  /** Signing out would lose a queue place or a hold in progress on the provider. */
  | 'ACCOUNT_BUSY'
  /** The hold has lapsed (or there is none to pay for): payment cannot open. */
  | 'HOLD_EXPIRED'
  | 'NOT_IMPLEMENTED';

// Generic API Response wrapper
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  /** Set when `success` is false. */
  code?: ApiErrorCode;
  /** For `VALIDATION`: the dotted paths of the payload fields that failed, e.g. `updates.arrivalDate`. */
  issues?: string[];
}
