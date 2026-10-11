/**
 * Classifies a transport failure, a request that got no response, so both HTTP clients
 * report it the same way (architecture-notes §12.30):
 *
 * - Chromium (`ElectronSessionHttpClient`, through Electron's `net`) fails with messages
 *   such as `net::ERR_CONNECTION_REFUSED`.
 * - Node's `fetch` (`NodeHttpClient`) fails with a `TypeError` whose `cause` carries a code
 *   such as `ECONNREFUSED` or `UND_ERR_SOCKET`.
 *
 * Only genuine, passing network failures are retryable. Requests blocked by policy or by a
 * certificate, and failures nobody recognises, are not.
 */

import type { HttpErrorReason } from './errors';

export interface TransportFailure {
  reason: Extract<HttpErrorReason, 'network' | 'blocked' | 'redirect-limit'>;
  retryable: boolean;
  /** The transport's own code, e.g. `ERR_CONNECTION_REFUSED` or `ECONNRESET`. */
  netError?: string;
}

/** Chromium net errors that can pass: the connection, DNS, the network or a proxy. */
const RETRYABLE_CHROMIUM = new Set([
  'ERR_ADDRESS_UNREACHABLE',
  'ERR_CONNECTION_ABORTED',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_FAILED',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_CONTENT_LENGTH_MISMATCH',
  'ERR_EMPTY_RESPONSE',
  'ERR_HTTP2_PING_FAILED',
  'ERR_HTTP2_PROTOCOL_ERROR',
  'ERR_HTTP2_SERVER_REFUSED_STREAM',
  'ERR_INCOMPLETE_CHUNKED_ENCODING',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_NAME_RESOLUTION_FAILED',
  'ERR_NETWORK_CHANGED',
  'ERR_NETWORK_IO_SUSPENDED',
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_QUIC_PROTOCOL_ERROR',
  'ERR_SOCKET_NOT_CONNECTED',
  'ERR_TIMED_OUT',
  'ERR_TUNNEL_CONNECTION_FAILED',
]);

/** Node and undici codes for the same kinds of failure. */
const RETRYABLE_NODE = new Set([
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CLOSED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** Refused by policy or by the client itself: retrying sends the same refused request. */
const BLOCKED = new Set([
  'ERR_ACCESS_DENIED',
  'ERR_BLOCKED_BY_ADMINISTRATOR',
  'ERR_BLOCKED_BY_CLIENT',
  'ERR_BLOCKED_BY_CSP',
  'ERR_BLOCKED_BY_RESPONSE',
  'ERR_DISALLOWED_URL_SCHEME',
  'ERR_INVALID_REDIRECT',
  // Also Node's code for a URL it cannot parse.
  'ERR_INVALID_URL',
  'ERR_NETWORK_ACCESS_DENIED',
  'ERR_UNKNOWN_URL_SCHEME',
  'ERR_UNSAFE_PORT',
  'ERR_UNSAFE_REDIRECT',
  // Node's certificate failures (Chromium's match CERTIFICATE below)
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

const CERTIFICATE = /^(ERR_CERT_|ERR_SSL_|ERR_BAD_SSL_|CERT_)/;

const REDIRECT_LIMIT = new Set(['ERR_TOO_MANY_REDIRECTS']);

const CHROMIUM_CODE = /\bnet::(ERR_[A-Z0-9_]+)/;

/** The transport error code: Chromium's `net::ERR_*`, or the first `code` on the cause chain. */
export function transportErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const { message, code, cause } = current as {
      message?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    if (typeof message === 'string') {
      const match = CHROMIUM_CODE.exec(message);
      if (match) return match[1];
    }
    if (typeof code === 'string' && code) return code;
    current = cause;
  }
  return undefined;
}

export function classifyTransportError(error: unknown): TransportFailure {
  const netError = transportErrorCode(error);
  if (netError === undefined) return { reason: 'network', retryable: false };
  if (RETRYABLE_CHROMIUM.has(netError) || RETRYABLE_NODE.has(netError)) {
    return { reason: 'network', retryable: true, netError };
  }
  if (REDIRECT_LIMIT.has(netError)) return { reason: 'redirect-limit', retryable: false, netError };
  if (BLOCKED.has(netError) || CERTIFICATE.test(netError)) {
    return { reason: 'blocked', retryable: false, netError };
  }
  return { reason: 'network', retryable: false, netError };
}
