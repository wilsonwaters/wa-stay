import type { ApiErrorCode } from '@shared/types/api.types';

const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION: 'Invalid request',
  FORBIDDEN: 'Forbidden',
  NO_PROFILE: 'No local profile exists',
  NOT_FOUND: 'Not found',
  CONFLICT: 'That is already in WA Stay',
  INTERNAL: 'Unexpected error',
  CAPABILITY: 'The provider does not support this',
  UNKNOWN_PROVIDER: 'Unknown provider',
  PROVIDER_ERROR: 'The provider could not be reached',
  ACCESS_GATE: 'Waiting in the provider queue',
  RATE_LIMITED: 'The provider asked for fewer requests',
  AUTH_REQUIRED: 'Sign in to the provider first',
  ACCOUNT_BUSY: 'The provider account is in use by a snipe or hold',
  HOLD_EXPIRED: 'The hold has expired',
  NOT_IMPLEMENTED: 'Not available yet',
};

export interface AppErrorOptions {
  /** The request fields at fault, as dotted paths (`releaseAt`, `stayParams.postcode`). */
  issues?: string[];
}

/**
 * An error with an API code. `ipc/handle.ts` maps it to `{ success: false, code, error }`
 * (with `issues` when given); any other thrown value becomes `INTERNAL`.
 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly issues?: string[];

  constructor(code: ApiErrorCode, message?: string, options: AppErrorOptions = {}) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    if (options.issues) this.issues = options.issues;
  }
}
