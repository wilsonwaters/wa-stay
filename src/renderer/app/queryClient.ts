import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api';

/**
 * Failures that come out the same however often they are retried: a rejected payload, a
 * provider without the capability, a missing or already existing record, a feature this build
 * does not have yet, or no `window.api` at all.
 */
const NO_RETRY_CODES = new Set([
  'VALIDATION',
  'CAPABILITY',
  'NOT_FOUND',
  'CONFLICT',
  'NOT_IMPLEMENTED',
  'API_UNAVAILABLE',
  // Asking again at once is what a rate limit asks us not to do.
  'RATE_LIMITED',
]);

/** Queries retry once, except for failures a retry cannot fix. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.code && NO_RETRY_CODES.has(error.code)) return false;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        retry: shouldRetryQuery,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

/** The app's one query client. Tests make their own with `createQueryClient()`. */
export const queryClient = createQueryClient();
