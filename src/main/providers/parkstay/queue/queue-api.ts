/**
 * The DBCA queue API, `queue.dbca.wa.gov.au`. ParkStay's own pages call
 * `GET /api/check-create-session/?session_key=…&queue_group=parkstayv2` to join or refresh
 * the queue; the answer says whether the session is `Active` (it may use ParkStay) or
 * `Waiting` (and where in the queue it is).
 *
 * The session key is the value of the `sitequeuesession` cookie the queue middleware sets on
 * `dbca.wa.gov.au`. A new session's key is 52 characters of `A-Z0-9`, as the ParkStay page
 * makes it. It is a credential: it is never logged and never sent to the renderer.
 */

import { randomInt } from 'crypto';
import type { ProviderId } from '@shared/types/provider.types';
import {
  isAbortError,
  ProviderError,
  ProviderHttpError,
  ProviderParseError,
  ProviderTimeoutError,
} from '../../sdk/errors';
import type { ParkStayClient } from '../client';
import { QUEUE_GROUP } from '../constants';
import type { QueueApiResponse } from '../types';

const KEY_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const SESSION_KEY_LENGTH = 52;

/** A new queue session key: 52 random characters from `A-Z0-9`. */
export function generateSessionKey(): string {
  let key = '';
  for (let i = 0; i < SESSION_KEY_LENGTH; i++)
    key += KEY_CHARACTERS[randomInt(KEY_CHARACTERS.length)];
  return key;
}

const withoutQuery = (url: string): string => url.split(/[?#]/)[0];

function isQueueApiResponse(body: unknown): body is QueueApiResponse {
  const response = body as QueueApiResponse | null;
  return (
    typeof response === 'object' &&
    response !== null &&
    typeof response.status === 'string' &&
    typeof response.session_key === 'string' &&
    response.session_key.length > 0
  );
}

export class QueueApi {
  constructor(
    private readonly client: ParkStayClient,
    private readonly providerId: ProviderId
  ) {}

  /** Joins the queue, or refreshes the session, with `sessionKey`. */
  async checkCreateSession(sessionKey: string, signal?: AbortSignal): Promise<QueueApiResponse> {
    let body: unknown;
    try {
      body = await this.client.getQueue<unknown>('/api/check-create-session/', {
        query: { session_key: sessionKey, queue_group: QUEUE_GROUP },
        signal,
      });
    } catch (error) {
      throw this.withoutKey(error);
    }
    if (!isQueueApiResponse(body)) {
      throw new ProviderParseError({
        providerId: this.providerId,
        message: `${this.providerId}: the DBCA queue answered with an unexpected shape`,
      });
    }
    return body;
  }

  /**
   * The request URL carries the session key, so an HTTP or timeout error is rebuilt with the
   * URL's query string and the cause left out, before anything can log it.
   */
  private withoutKey(error: unknown): unknown {
    if (isAbortError(error)) return error;
    if (error instanceof ProviderHttpError) {
      return new ProviderHttpError({
        providerId: this.providerId,
        status: error.status,
        url: withoutQuery(error.url),
        reason: error.reason,
        netError: error.netError,
        message: error.message,
        retryable: error.retryable,
      });
    }
    if (error instanceof ProviderTimeoutError) {
      return new ProviderTimeoutError({
        providerId: this.providerId,
        url: withoutQuery(error.url),
        timeoutMs: error.timeoutMs,
      });
    }
    if (error instanceof ProviderError) return error;
    return new ProviderError({
      providerId: this.providerId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
