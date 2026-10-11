/**
 * Pure helpers for the location catalogue service: deadlines on provider calls, error codes
 * for per-provider failures, cache keys for stays, and summaries derived from descriptions.
 */

import sanitizeHtml from 'sanitize-html';
import type { CatalogErrorCode } from '@shared/types/catalog.types';
import type { ProviderId, StayQuery } from '@shared/types/provider.types';
import { createAbortError, ProviderError } from '../../providers/sdk/errors';

/** How long a derived summary may be (architecture-notes §5: FTS indexes it). */
export const DERIVED_SUMMARY_LENGTH = 200;

/** The error a provider call rejects with when it misses its deadline. */
export function deadlineError(providerId: ProviderId, ms: number): ProviderError {
  return new ProviderError({
    providerId,
    code: 'timeout',
    retryable: true,
    message: `${providerId}: no answer within ${ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`}`,
  });
}

/**
 * Runs `task` with a signal that aborts after `ms` (rejecting with `deadlineError`) or when
 * `parent` aborts (rejecting with its AbortError). It settles on time even when the task
 * ignores its signal.
 */
export function withDeadline<T>(
  providerId: ProviderId,
  ms: number,
  parent: AbortSignal,
  task: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    const finish = (): void => {
      clearTimeout(timer);
      parent.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      finish();
      const error = createAbortError(parent);
      controller.abort(error);
      reject(error);
    };
    const timer = setTimeout(() => {
      finish();
      const error = deadlineError(providerId, ms);
      controller.abort(error);
      reject(error);
    }, ms);
    if (parent.aborted) {
      onAbort();
      return;
    }
    parent.addEventListener('abort', onAbort, { once: true });
    Promise.resolve()
      .then(() => task(controller.signal))
      .then(
        (value) => {
          finish();
          resolve(value);
        },
        (error: unknown) => {
          finish();
          reject(error);
        }
      );
  });
}

/** Why a provider's part of a cross-provider call failed, for `CatalogAvailabilityResult.errors`. */
export function catalogErrorCode(error: unknown): CatalogErrorCode {
  if (!(error instanceof ProviderError)) return 'unknown';
  switch (error.code) {
    case 'access-gate':
      return 'access-gate';
    case 'timeout':
      return 'timeout';
    case 'http':
      return 'http';
    case 'parse':
      return 'parse';
    default:
      return 'unknown';
  }
}

/** A failure's message, for a status or an error entry. */
export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unexpected error';
}

/**
 * A stay as a cache key: two stays that ask a provider the same question have the same key
 * (absent counts are 0; stay params are sorted).
 */
export function stayCacheKey(stay: StayQuery): string {
  const params = Object.entries(stay.params ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify([
    stay.arrival,
    stay.departure,
    stay.adults,
    stay.children ?? 0,
    stay.infants ?? 0,
    stay.concessions ?? 0,
    stay.equipment ?? '',
    params,
  ]);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : +name.slice(1);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : entity;
    }
    return ENTITIES[name.toLowerCase()] ?? entity;
  });
}

/** Block-level tags whose boundaries separate words. */
const BLOCK_BOUNDARY = /<\/?(?:p|br|hr|div|li|ul|ol|h[1-6]|tr|td|th|table|blockquote)\b[^>]*>/gi;

/**
 * The first `DERIVED_SUMMARY_LENGTH` characters of an HTML description's text, with its
 * whitespace collapsed; `undefined` when it has no text.
 */
export function summaryFromHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = decodeEntities(
    sanitizeHtml(html.replace(BLOCK_BOUNDARY, ' $&'), {
      allowedTags: [],
      allowedAttributes: {},
      nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'iframe'],
    })
  )
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return text.slice(0, DERIVED_SUMMARY_LENGTH).trimEnd();
}
