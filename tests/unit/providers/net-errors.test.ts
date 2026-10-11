/**
 * Transport failure classification: Chromium `net::ERR_*` messages and Node/undici codes
 * map to the same reasons, and only genuine network failures are retryable.
 */

import { classifyTransportError, transportErrorCode } from '@main/providers/sdk';

/** Node's fetch: `TypeError('fetch failed')` with the socket error as its cause. */
const nodeFailure = (code: string): Error =>
  new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });

describe('classifyTransportError', () => {
  it.each<[string, unknown, string, boolean, string | undefined]>([
    [
      'Chromium refused',
      new Error('net::ERR_CONNECTION_REFUSED'),
      'network',
      true,
      'ERR_CONNECTION_REFUSED',
    ],
    [
      'Chromium offline',
      new Error('net::ERR_INTERNET_DISCONNECTED'),
      'network',
      true,
      'ERR_INTERNET_DISCONNECTED',
    ],
    [
      'Chromium blocked',
      new Error('net::ERR_BLOCKED_BY_CLIENT'),
      'blocked',
      false,
      'ERR_BLOCKED_BY_CLIENT',
    ],
    [
      'Chromium unsafe port',
      new Error('net::ERR_UNSAFE_PORT'),
      'blocked',
      false,
      'ERR_UNSAFE_PORT',
    ],
    [
      'Chromium certificate',
      new Error('net::ERR_CERT_DATE_INVALID'),
      'blocked',
      false,
      'ERR_CERT_DATE_INVALID',
    ],
    [
      'Chromium redirect loop',
      new Error('net::ERR_TOO_MANY_REDIRECTS'),
      'redirect-limit',
      false,
      'ERR_TOO_MANY_REDIRECTS',
    ],
    [
      'Chromium unknown',
      new Error('net::ERR_INVALID_RESPONSE'),
      'network',
      false,
      'ERR_INVALID_RESPONSE',
    ],
    ['Node refused', nodeFailure('ECONNREFUSED'), 'network', true, 'ECONNREFUSED'],
    ['Node reset', nodeFailure('ECONNRESET'), 'network', true, 'ECONNRESET'],
    ['Node DNS', nodeFailure('ENOTFOUND'), 'network', true, 'ENOTFOUND'],
    ['undici socket', nodeFailure('UND_ERR_SOCKET'), 'network', true, 'UND_ERR_SOCKET'],
    ['Node certificate', nodeFailure('CERT_HAS_EXPIRED'), 'blocked', false, 'CERT_HAS_EXPIRED'],
    [
      'Node self-signed',
      nodeFailure('DEPTH_ZERO_SELF_SIGNED_CERT'),
      'blocked',
      false,
      'DEPTH_ZERO_SELF_SIGNED_CERT',
    ],
    ['no code at all', new Error('something odd'), 'network', false, undefined],
    ['not an error', 'boom', 'network', false, undefined],
  ])('%s', (_label, error, reason, retryable, netError) => {
    expect(classifyTransportError(error)).toEqual(
      netError === undefined ? { reason, retryable } : { reason, retryable, netError }
    );
  });
});

describe('transportErrorCode', () => {
  it('finds a code a few causes deep, and stops on a cycle', () => {
    const inner = Object.assign(new Error('x'), { code: 'EPIPE' });
    expect(transportErrorCode(new Error('a', { cause: new Error('b', { cause: inner }) }))).toBe(
      'EPIPE'
    );
    const cyclic: { message: string; cause?: unknown } = { message: 'loop' };
    cyclic.cause = cyclic;
    expect(transportErrorCode(cyclic)).toBeUndefined();
  });
});
