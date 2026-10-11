/**
 * The renderer's one door to the main process. Everything under `renderer/api/` reaches
 * `window.api` through here, and nothing outside `renderer/api/` touches `window.api` at all
 * (architecture-notes §8; tests/unit/renderer/api-boundary.test.ts enforces it).
 */

import type { WindowApi } from '../../shared/contracts';
import type { APIResponse, ApiErrorCode as ContractErrorCode } from '../../shared/types/api.types';

/**
 * Why a call failed. The contract's codes, plus:
 * - `CAPABILITY`: the provider does not offer what was asked (V1 adds it to the contract);
 * - `API_UNAVAILABLE`: there is no `window.api`, because the renderer is running in a plain
 *   browser (`npm run dev:renderer`) rather than inside the WA Stay app.
 */
export type ApiErrorCode = ContractErrorCode | 'CAPABILITY' | 'API_UNAVAILABLE';

/** A failed `window.api` call: the response's `error` as the message, and its `code`. */
export class ApiError extends Error {
  readonly code?: ApiErrorCode | (string & Record<never, never>);
  /** For `VALIDATION`: the payload paths that failed. */
  readonly issues?: string[];

  constructor(message: string, code?: string, issues?: string[]) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.issues = issues;
  }
}

/** Shown when the renderer is opened outside the app, so there is no main process to ask. */
export const API_UNAVAILABLE_MESSAGE =
  "WA Stay's background service isn't available, so nothing can be loaded or saved here.";

/** True inside the WA Stay app, where the preload has exposed `window.api`. */
export function isApiAvailable(): boolean {
  return typeof window !== 'undefined' && window.api != null;
}

/** `window.api`, or an `ApiError('API_UNAVAILABLE')` when the renderer runs outside the app. */
export function getApi(): WindowApi {
  if (!isApiAvailable()) throw new ApiError(API_UNAVAILABLE_MESSAGE, 'API_UNAVAILABLE');
  return window.api;
}

type ApiCall<T> = Promise<APIResponse<T>> | ((api: WindowApi) => Promise<APIResponse<T>>);

/**
 * Resolves an `APIResponse` to its `data`, or rejects with an `ApiError` carrying the
 * response's message and code. Pass the call's promise, or a function of the API so a missing
 * `window.api` also becomes an `ApiError`:
 *
 *   queryFn: () => unwrap((api) => api.app.getInfo())
 */
export async function unwrap<T>(call: ApiCall<T>): Promise<T> {
  let response: APIResponse<T>;
  try {
    response = await (typeof call === 'function' ? call(getApi()) : call);
  } catch (error) {
    throw toApiError(error);
  }
  if (!response || !response.success) {
    throw new ApiError(
      response?.error || response?.message || 'WA Stay could not complete that request.',
      response?.code,
      response?.issues
    );
  }
  return response.data as T;
}

/** Any thrown value as an `ApiError`, keeping an existing one as it is. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) return new ApiError(error.message);
  return new ApiError(String(error));
}
