/**
 * Provider errors: their fields, and `toApiError`'s mapping to API codes.
 */

import {
  AccessGateError,
  BrowserUnavailableError,
  createAbortError,
  isAbortError,
  ProviderAuthRequiredError,
  ProviderCapabilityError,
  ProviderError,
  ProviderHttpError,
  ProviderParseError,
  ProviderRegistrationError,
  ProviderTimeoutError,
  throwIfAborted,
  toApiError,
  UnknownProviderError,
} from '@main/providers/sdk';

describe('toApiError', () => {
  it.each<[string, string, Error]>([
    ['ProviderCapabilityError', 'CAPABILITY', new ProviderCapabilityError('fake', 'holds')],
    ['UnknownProviderError', 'UNKNOWN_PROVIDER', new UnknownProviderError('nope')],
    [
      'ProviderHttpError',
      'PROVIDER_ERROR',
      new ProviderHttpError({ providerId: 'fake', status: 500, url: 'https://x.example/a' }),
    ],
    [
      'ProviderHttpError 429',
      'RATE_LIMITED',
      new ProviderHttpError({ providerId: 'fake', status: 429, url: 'https://x.example/a' }),
    ],
    [
      'ProviderTimeoutError',
      'PROVIDER_ERROR',
      new ProviderTimeoutError({ providerId: 'fake', url: 'https://x.example/a', timeoutMs: 100 }),
    ],
    [
      'ProviderParseError',
      'PROVIDER_ERROR',
      new ProviderParseError({ providerId: 'fake', message: 'not JSON' }),
    ],
    [
      'BrowserUnavailableError',
      'PROVIDER_ERROR',
      new BrowserUnavailableError('fake', 'no-browser'),
    ],
    [
      'a plain ProviderError',
      'PROVIDER_ERROR',
      new ProviderError({ providerId: 'fake', message: 'odd' }),
    ],
    ['AccessGateError', 'ACCESS_GATE', new AccessGateError('fake', 'waiting')],
    ['ProviderAuthRequiredError', 'AUTH_REQUIRED', new ProviderAuthRequiredError('fake')],
    ['ProviderRegistrationError', 'INTERNAL', new ProviderRegistrationError('fake', 'bad')],
    ['a plain Error', 'INTERNAL', new Error('boom')],
  ])('maps %s to %s', (_name, code, error) => {
    expect(toApiError(error)).toEqual({ code, message: error.message });
  });

  it('maps a non-Error to INTERNAL with a generic message', () => {
    expect(toApiError('boom')).toEqual({ code: 'INTERNAL', message: 'Unexpected error' });
  });
});

describe('provider errors', () => {
  it('are all ProviderErrors with a provider id, code and retryable flag', () => {
    const capability = new ProviderCapabilityError('fake', 'holds');
    expect(capability).toBeInstanceOf(ProviderError);
    expect(capability).toBeInstanceOf(Error);
    expect(capability).toMatchObject({
      name: 'ProviderCapabilityError',
      providerId: 'fake',
      capability: 'holds',
      code: 'capability',
      retryable: false,
    });
  });

  it('marks 5xx, 429 and no-response HTTP errors retryable, 4xx not', () => {
    const http = (status: number) =>
      new ProviderHttpError({ providerId: 'fake', status, url: 'https://x.example/' });
    expect([500, 503, 429, 408, 0].map((s) => http(s).retryable)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect([400, 401, 404].map((s) => http(s).retryable)).toEqual([false, false, false]);
  });

  it('derives the reason from the status, and retryable from the reason', () => {
    const http = (options: Partial<ConstructorParameters<typeof ProviderHttpError>[0]>) =>
      new ProviderHttpError({
        providerId: 'fake',
        status: 0,
        url: 'https://x.example/a?q=1',
        ...options,
      });

    expect(http({ status: 503 })).toMatchObject({ reason: 'status', retryable: true });
    expect(http({ status: 0 })).toMatchObject({ reason: 'network', retryable: true });
    expect(http({ status: 302, reason: 'redirect' })).toMatchObject({ retryable: false });
    expect(http({ status: 302, reason: 'redirect-limit' })).toMatchObject({ retryable: false });
    expect(http({ reason: 'network', retryable: false }).retryable).toBe(false);
    const blocked = http({ reason: 'blocked', netError: 'ERR_BLOCKED_BY_CLIENT' });
    expect(blocked).toMatchObject({ retryable: false, netError: 'ERR_BLOCKED_BY_CLIENT' });
    expect(blocked.message).toBe(
      'fake: the request to https://x.example/a was blocked (ERR_BLOCKED_BY_CLIENT)'
    );
    expect(http({ netError: 'ECONNRESET' }).message).toBe(
      'fake: no response from https://x.example/a (ECONNRESET)'
    );
  });

  it('keeps the query string (personal details) out of HTTP messages', () => {
    const error = new ProviderHttpError({
      providerId: 'parkstay',
      status: 500,
      url: 'https://parkstay.dbca.wa.gov.au/api/x?email=a@b.example',
    });
    expect(error.message).toBe('parkstay: HTTP 500 from https://parkstay.dbca.wa.gov.au/api/x');
    expect(error.url).toContain('email=');
  });

  it('keeps the cause', () => {
    const cause = new Error('socket hang up');
    expect(
      new ProviderHttpError({ providerId: 'fake', status: 0, url: 'https://x.example/', cause })
        .cause
    ).toBe(cause);
  });

  it('AccessGateError carries the state; waiting is retryable', () => {
    expect(new AccessGateError('parkstay', 'waiting')).toMatchObject({
      state: 'waiting',
      retryable: true,
    });
    expect(new AccessGateError('parkstay', 'error')).toMatchObject({
      state: 'error',
      retryable: false,
    });
  });
});

describe('abort helpers', () => {
  it('createAbortError uses the signal reason when it is an AbortError', () => {
    const controller = new AbortController();
    controller.abort();
    expect(createAbortError(controller.signal)).toBe(controller.signal.reason);
  });

  it('createAbortError makes an AbortError for a custom reason', () => {
    const controller = new AbortController();
    controller.abort(new Error('user left'));
    const error = createAbortError(controller.signal);
    expect(isAbortError(error)).toBe(true);
  });

  it('throwIfAborted throws only for an aborted signal', () => {
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal)).not.toThrow();
    expect(() => throwIfAborted(undefined)).not.toThrow();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrow(
      expect.objectContaining({ name: 'AbortError' })
    );
    expect(isAbortError(new Error('x'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
