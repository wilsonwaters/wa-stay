/**
 * ParkStay sign-in: the `browser-session` definition and `isSignedIn`, which asks
 * `GET /api/profile` (PQ2) through `NodeHttpClient` against the local ParkStay fixture
 * server: a profile is signed in, 401/403 signed out, and the DBCA queue, a 5xx, a body
 * that is not a profile, a timeout or no answer are `unknown` with a reason.
 */

import {
  classifyProfileResponse,
  createParkStayAuth,
  PARKSTAY_SIGN_IN_COMPLETE,
  PARKSTAY_SIGN_IN_ORIGINS,
  PARKSTAY_SIGN_IN_URL,
} from '@main/providers/parkstay/auth';
import { parkstayFactory } from '@main/providers/parkstay';
import { authViolation } from '@main/providers/registry';
import {
  CHROME_USER_AGENT,
  matchesOrigin,
  matchesUrlPattern,
  NodeHttpClient,
} from '@main/providers/sdk';
import {
  startParkStayFixtureServer,
  type ParkStayFixtureServer,
} from '@tests/utils/parkstay-fixture-server';

const PROFILE = {
  id: 4821,
  email: 'a@b.au',
  first_name: 'Ann',
  last_name: 'Lee',
  residential_address: { line1: '1 Sweep St', postcode: '6000' },
  phone_number: '0400 000 000',
  mobile_number: null,
};

describe('ParkStay sign-in definition', () => {
  it('signs in at /ssologin, on the ParkStay, SSO, B2C and queue origins, done at /login-success/', () => {
    const auth = createParkStayAuth();
    expect(auth).toMatchObject({
      kind: 'browser-session',
      signInUrl: 'https://parkstay.dbca.wa.gov.au/ssologin',
    });
    expect(PARKSTAY_SIGN_IN_URL).toBe(auth.signInUrl);
    expect([...auth.allowedOrigins]).toEqual([
      'https://parkstay.dbca.wa.gov.au',
      'https://auth2.dbca.wa.gov.au',
      'https://dbcab2c.b2clogin.com',
      'https://login.microsoftonline.com',
      'https://queue.dbca.wa.gov.au',
    ]);
    expect(auth.allowedOrigins).toBe(PARKSTAY_SIGN_IN_ORIGINS);
    expect(auth.completionUrlPatterns).toBe(PARKSTAY_SIGN_IN_COMPLETE);
    expect(authViolation(auth)).toBeUndefined();

    expect(matchesOrigin(auth.signInUrl, auth.allowedOrigins)).toBe(true);
    expect(
      matchesUrlPattern(
        'https://parkstay.dbca.wa.gov.au/login-success/',
        auth.completionUrlPatterns ?? []
      )
    ).toBe(true);
    expect(
      matchesUrlPattern(
        'https://parkstay.dbca.wa.gov.au/success/',
        auth.completionUrlPatterns ?? []
      )
    ).toBe(false);
  });

  it('is the auth module of the ParkStay provider, whose account is optional', () => {
    expect(parkstayFactory.manifest.capabilities.account).toBe('optional');
  });
});

describe('ParkStay isSignedIn (GET /api/profile on the fixture server)', () => {
  let server: ParkStayFixtureServer;
  let http: NodeHttpClient;

  beforeEach(async () => {
    server = await startParkStayFixtureServer();
    http = new NodeHttpClient({ providerId: 'parkstay' });
  });

  afterEach(async () => {
    await server.close();
  });

  const isSignedIn = (signal?: AbortSignal) =>
    createParkStayAuth(server.endpoints).isSignedIn(http, signal);

  it('a 200 profile is signed in as its email, named first_name last_name', async () => {
    server.overrides.set('/api/profile', { status: 200, body: PROFILE });

    await expect(isSignedIn()).resolves.toEqual({
      state: 'signed-in',
      email: 'a@b.au',
      displayName: 'Ann Lee',
    });
    const [request] = server.requestsTo('/api/profile');
    expect(request.method).toBe('GET');
    expect(request.path).toBe('/api/profile');
    expect(request.headers['user-agent']).toBe(CHROME_USER_AGENT);
    expect(request.headers.referer).toBe('https://parkstay.dbca.wa.gov.au/');
  });

  it('a 403 "credentials were not provided" is signed out', async () => {
    server.overrides.set('/api/profile', {
      status: 403,
      body: { detail: 'Authentication credentials were not provided.' },
    });
    await expect(isSignedIn()).resolves.toEqual({ state: 'signed-out' });
  });

  it('a 401 is signed out', async () => {
    server.overrides.set('/api/profile', { status: 401, body: { detail: 'Unauthorized' } });
    await expect(isSignedIn()).resolves.toEqual({ state: 'signed-out' });
  });

  it('the queue interstitial is unknown (queue)', async () => {
    server.queueGate = 'html';
    await expect(isSignedIn()).resolves.toEqual({ state: 'unknown', reason: 'queue' });
  });

  it('a redirect to the waiting room is unknown (queue)', async () => {
    server.queueGate = 'redirect';
    await expect(isSignedIn()).resolves.toEqual({ state: 'unknown', reason: 'queue' });
  });

  it('a 502 is unknown (http 502)', async () => {
    server.overrides.set('/api/profile', { status: 502, body: { error: 'Bad gateway' } });
    await expect(isSignedIn()).resolves.toEqual({ state: 'unknown', reason: 'http 502' });
  });

  it('no answer at all is unknown (network)', async () => {
    const closed = { ...server.endpoints };
    await server.close();
    await expect(createParkStayAuth(closed).isSignedIn(http)).resolves.toEqual({
      state: 'unknown',
      reason: 'network',
    });
    server = await startParkStayFixtureServer();
  });

  it('rethrows the caller abort', async () => {
    server.overrides.set('/api/profile', { status: 200, body: PROFILE });
    server.delayMs = 200;
    const controller = new AbortController();
    const pending = isSignedIn(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('classifyProfileResponse', () => {
  const ok = (body: unknown) => ({
    status: 200,
    url: 'https://parkstay.dbca.wa.gov.au/api/profile',
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

  it('reads only the email and the names; a missing name leaves displayName out', () => {
    expect(classifyProfileResponse(ok({ ...PROFILE, first_name: '', last_name: ' ' }))).toEqual({
      state: 'signed-in',
      email: 'a@b.au',
    });
    expect(classifyProfileResponse(ok({ email: ' a@b.au ', first_name: 'Ann' }))).toEqual({
      state: 'signed-in',
      email: 'a@b.au',
      displayName: 'Ann',
    });
  });

  it('a 200 that is not a profile is unknown (parse)', () => {
    expect(classifyProfileResponse(ok({ id: 1 }))).toEqual({ state: 'unknown', reason: 'parse' });
    expect(classifyProfileResponse(ok([PROFILE]))).toEqual({ state: 'unknown', reason: 'parse' });
    expect(
      classifyProfileResponse({
        ...ok(null),
        body: '<html>ParkStay</html>',
        contentType: 'text/html',
      })
    ).toEqual({ state: 'unknown', reason: 'parse' });
  });

  it('a final URL on the queue site is unknown (queue), even with a 403', () => {
    expect(
      classifyProfileResponse({
        status: 403,
        url: 'https://queue.dbca.wa.gov.au/site-queue/waiting-room/parkstayv2/',
        contentType: 'text/html',
        body: '',
      })
    ).toEqual({ state: 'unknown', reason: 'queue' });
  });
});
