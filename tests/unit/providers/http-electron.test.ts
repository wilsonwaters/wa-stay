/**
 * ElectronSessionHttpClient against a mocked `electron`: the provider partition, the user
 * agent, `net.request` options (session, `credentials: 'include'`, `redirect: 'manual'`,
 * Referer policy), one request per hop, timeouts, `net::ERR_*` classification, and the
 * cookie store mapping onto `ses.cookies`. `npm run test:electron` runs the real thing.
 */

import { EventEmitter } from 'events';
import { ElectronSessionHttpClient, providerPartition } from '@main/providers/sdk/http-electron';
import {
  CHROME_MAJOR_VERSION,
  CHROME_USER_AGENT,
  chromeBrands,
  chromeUserAgent,
  isAbortError,
  runtimeChromeMajor,
  ProviderHttpError,
  ProviderTimeoutError,
} from '@main/providers/sdk';

jest.mock('electron', () => {
  const ses = {
    setUserAgent: jest.fn(),
    cookies: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
  };
  return {
    session: { fromPartition: jest.fn(() => ses) },
    net: { request: jest.fn() },
    __ses: ses,
  };
});

const electron = jest.requireMock('electron') as {
  session: { fromPartition: jest.Mock };
  net: { request: jest.Mock };
  __ses: {
    setUserAgent: jest.Mock;
    cookies: { get: jest.Mock; set: jest.Mock; remove: jest.Mock };
  };
};
const ses = electron.__ses;

/** A fake `ClientRequest`: `end()` runs the scripted reply on the next tick. */
class FakeRequest extends EventEmitter {
  readonly end = jest.fn((_body?: string) => {
    setImmediate(() => this.reply(this));
  });
  readonly abort = jest.fn(() => this.emit('abort'));

  constructor(
    readonly options: Record<string, unknown>,
    private readonly reply: (request: FakeRequest) => void
  ) {
    super();
  }
}

type Reply = (request: FakeRequest) => void;

/** A reply with a response: status, raw headers and a body in one chunk. */
const respond =
  (status: number, rawHeaders: string[] = [], body = ''): Reply =>
  (request) => {
    const response = Object.assign(new EventEmitter(), {
      statusCode: status,
      rawHeaders,
      headers: {},
    });
    request.emit('response', response);
    setImmediate(() => {
      if (body) response.emit('data', Buffer.from(body));
      response.emit('end');
    });
  };

const json = (body: unknown): Reply =>
  respond(200, ['Content-Type', 'application/json'], JSON.stringify(body));

const redirect =
  (status: number, location: string, setCookie: string[] = []): Reply =>
  (request) => {
    request.emit('redirect', status, 'GET', new URL(location, String(request.options.url)).href, {
      location: [location],
      ...(setCookie.length ? { 'set-cookie': setCookie } : {}),
    });
  };

const fail =
  (message: string): Reply =>
  (request) =>
    request.emit('error', new Error(message));

/** Scripts `net.request`: one reply per request, in order. Returns the requests made. */
function script(...replies: Reply[]): FakeRequest[] {
  const requests: FakeRequest[] = [];
  electron.net.request.mockImplementation((options: Record<string, unknown>) => {
    const reply = replies[Math.min(requests.length, replies.length - 1)];
    const request = new FakeRequest(options, reply);
    requests.push(request);
    return request;
  });
  return requests;
}

describe('ElectronSessionHttpClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ses.cookies.get.mockResolvedValue([]);
    ses.cookies.set.mockResolvedValue(undefined);
    ses.cookies.remove.mockResolvedValue(undefined);
  });

  it("uses the provider's persistent partition, persist:provider-<id>", () => {
    const client = new ElectronSessionHttpClient({ providerId: 'parkstay' });

    expect(electron.session.fromPartition).toHaveBeenCalledWith('persist:provider-parkstay');
    expect(client.partition).toBe('persist:provider-parkstay');
    expect(providerPartition('rac')).toBe('persist:provider-rac');
  });

  it('sets the Chrome user agent on the partition exactly once', async () => {
    script(json({ ok: true }));
    const client = new ElectronSessionHttpClient({ providerId: 'parkstay' });
    await client.getJson('https://parkstay.dbca.wa.gov.au/api/a');
    await client
      .withDefaults({ headers: { Referer: 'https://x.example/' } })
      .getJson('https://parkstay.dbca.wa.gov.au/api/b');

    expect(ses.setUserAgent).toHaveBeenCalledTimes(1);
    // Outside Electron there is no process.versions.chrome: the fixed version is used
    expect(ses.setUserAgent).toHaveBeenCalledWith(CHROME_USER_AGENT);
    expect(client.userAgent).toBe(CHROME_USER_AGENT);
    expect(CHROME_USER_AGENT).toMatch(/Chrome\/\d+/);
    expect(CHROME_USER_AGENT).not.toMatch(/axios|python|curl|java|httpclient|electron/i);
  });

  it("presents the Chromium version Electron runs, rewriting a provider's User-Agent and sec-ch-ua", async () => {
    const requests = script(json({ ok: true }));
    const client = new ElectronSessionHttpClient({ providerId: 'parkstay', chromeMajor: '120' });

    await client.getJson('https://parkstay.dbca.wa.gov.au/api/a', {
      headers: {
        'User-Agent': CHROME_USER_AGENT,
        'sec-ch-ua': chromeBrands('131'),
        'sec-ch-ua-platform': '"Windows"',
      },
    });

    expect(client.userAgent).toBe(chromeUserAgent('120'));
    expect(ses.setUserAgent).toHaveBeenCalledWith(chromeUserAgent('120'));
    expect(requests[0].options.headers).toMatchObject({
      'user-agent': chromeUserAgent('120'),
      'sec-ch-ua': chromeBrands('120'),
      'sec-ch-ua-platform': '"Windows"',
    });
  });

  it('reads the Chromium major version from process.versions', () => {
    expect(runtimeChromeMajor({ chrome: '120.0.6099.291' })).toBe('120');
    expect(runtimeChromeMajor({})).toBe(CHROME_MAJOR_VERSION);
  });

  it("sends each hop with net.request on the session: credentials 'include', redirect 'manual'", async () => {
    const requests = script(json({ ok: true }));
    const client = new ElectronSessionHttpClient({ providerId: 'parkstay' });

    const data = await client.getJson('https://parkstay.dbca.wa.gov.au/api/campground_map/', {
      query: { format: 'json' },
    });

    expect(data).toEqual({ ok: true });
    expect(electron.net.request).toHaveBeenCalledTimes(1);
    const [request] = requests;
    expect(request.options).toMatchObject({
      method: 'GET',
      url: 'https://parkstay.dbca.wa.gov.au/api/campground_map/?format=json',
      session: ses,
      credentials: 'include',
      redirect: 'manual',
    });
    expect(request.options).not.toHaveProperty('referrerPolicy');
    expect(request.end).toHaveBeenCalledWith(undefined);
  });

  it("passes the Referer header with referrerPolicy 'unsafe-url', so Chromium keeps it", async () => {
    const requests = script(json({}));
    const client = new ElectronSessionHttpClient({ providerId: 'parkstay' });

    await client.getJson('https://parkstay.dbca.wa.gov.au/api/x', {
      headers: { Referer: 'https://parkstay.dbca.wa.gov.au/search?a=1' },
    });

    const [request] = requests;
    expect(request.options.headers).toMatchObject({
      referer: 'https://parkstay.dbca.wa.gov.au/search?a=1',
    });
    expect(request.options.referrerPolicy).toBe('unsafe-url');
  });

  it('posts a form body', async () => {
    const requests = script(json({}));
    const client = new ElectronSessionHttpClient({ providerId: 'parkstay' });
    await client.postForm('https://parkstay.dbca.wa.gov.au/api/create_booking', { campsite: 3 });

    const [request] = requests;
    expect(request.options.method).toBe('POST');
    expect(request.end).toHaveBeenCalledWith('campsite=3');
    expect((request.options.headers as Record<string, string>)['content-type']).toContain(
      'application/x-www-form-urlencoded'
    );
  });

  it('stops each redirect (abort) and sends the next hop itself, reporting the final URL', async () => {
    const requests = script(
      redirect(302, '/queue', ['sitequeuesession=AB=C; Domain=dbca.wa.gov.au']),
      json({ done: true })
    );
    const client = new ElectronSessionHttpClient({ providerId: 'parkstay' });

    const response = await client.request('GET', 'https://parkstay.dbca.wa.gov.au/api/x');

    expect(requests.map((r) => r.options.url)).toEqual([
      'https://parkstay.dbca.wa.gov.au/api/x',
      'https://parkstay.dbca.wa.gov.au/queue',
    ]);
    expect(requests[0].abort).toHaveBeenCalled();
    expect(response).toMatchObject({ status: 200, url: 'https://parkstay.dbca.wa.gov.au/queue' });
    expect(await response.json()).toEqual({ done: true });
  });

  it("returns the 3xx under redirect: 'manual', with its headers", async () => {
    script(redirect(302, '/queue', ['a=1', 'b=2']));
    const client = new ElectronSessionHttpClient({ providerId: 'parkstay' });

    const response = await client.request('GET', 'https://parkstay.dbca.wa.gov.au/api/x', {
      redirect: 'manual',
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/queue');
    expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(await response.text()).toBe('');
  });

  it('keeps repeated response headers apart (rawHeaders) and drops malformed ones', async () => {
    script(respond(204, ['Set-Cookie', 'a=1', 'Set-Cookie', 'b=2', 'X-One', 'x', 'Bad Name', 'y']));
    const client = new ElectronSessionHttpClient({ providerId: 'parkstay' });

    const response = await client.request('GET', 'https://parkstay.dbca.wa.gov.au/api/x');

    expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(response.headers.get('x-one')).toBe('x');
  });

  it('answers a 401 challenge with no credentials, so the 401 comes back', async () => {
    script((request) => {
      const callback = jest.fn();
      request.emit('login', { isProxy: false }, callback);
      expect(callback).toHaveBeenCalledWith();
      respond(401)(request);
    });
    const client = new ElectronSessionHttpClient({ providerId: 'parkstay' });

    expect((await client.request('GET', 'https://parkstay.dbca.wa.gov.au/api/x')).status).toBe(401);
  });

  it('times out with ProviderTimeoutError and aborts the request', async () => {
    const requests = script(() => undefined);
    const client = new ElectronSessionHttpClient({ providerId: 'parkstay' });

    const error = await client
      .request('GET', 'https://parkstay.dbca.wa.gov.au/api/x', { timeoutMs: 20 })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ProviderTimeoutError);
    expect(isAbortError(error)).toBe(false);
    expect(requests[0].abort).toHaveBeenCalled();
  });

  it.each([
    ['net::ERR_CONNECTION_REFUSED', 'network', true],
    ['net::ERR_NAME_NOT_RESOLVED', 'network', true],
    ['net::ERR_BLOCKED_BY_CLIENT', 'blocked', false],
    ['net::ERR_CERT_AUTHORITY_INVALID', 'blocked', false],
    ['net::ERR_TOO_MANY_REDIRECTS', 'redirect-limit', false],
    ['net::ERR_INVALID_RESPONSE', 'network', false],
  ])('classifies %s as %s (retryable %s)', async (message, reason, retryable) => {
    script(fail(message));
    const client = new ElectronSessionHttpClient({ providerId: 'parkstay' });

    const error = await client.request('GET', 'https://parkstay.dbca.wa.gov.au/').catch((e) => e);

    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error).toMatchObject({
      status: 0,
      reason,
      retryable,
      netError: message.replace('net::', ''),
    });
  });

  it('never sends a non-https URL', async () => {
    const client = new ElectronSessionHttpClient({ providerId: 'parkstay' });

    await expect(client.request('GET', 'file:///etc/passwd')).rejects.toMatchObject({
      reason: 'blocked',
      retryable: false,
    });
    expect(electron.net.request).not.toHaveBeenCalled();
  });

  describe('cookies', () => {
    it('get maps to ses.cookies.get({ url, name })', async () => {
      ses.cookies.get.mockResolvedValue([
        {
          name: 'sitequeuesession',
          value: 'AB=C==',
          domain: '.dbca.wa.gov.au',
          hostOnly: false,
          path: '/',
          secure: true,
          httpOnly: false,
          session: true,
          sameSite: 'no_restriction',
        },
      ]);
      const client = new ElectronSessionHttpClient({ providerId: 'parkstay' });

      const cookie = await client.cookies.get('https://queue.dbca.wa.gov.au/', 'sitequeuesession');

      expect(ses.cookies.get).toHaveBeenCalledWith({
        url: 'https://queue.dbca.wa.gov.au/',
        name: 'sitequeuesession',
      });
      expect(cookie).toEqual({
        name: 'sitequeuesession',
        value: 'AB=C==',
        domain: 'dbca.wa.gov.au',
        hostOnly: false,
        path: '/',
        secure: true,
        httpOnly: false,
        expires: undefined,
        sameSite: 'none',
      });
    });

    it('getAll maps to ses.cookies.get({ url }), with expiry in milliseconds', async () => {
      ses.cookies.get.mockResolvedValue([
        {
          name: 'a',
          value: '1',
          domain: 'parkstay.dbca.wa.gov.au',
          hostOnly: true,
          path: '/',
          expirationDate: 1_800_000_000,
        },
      ]);
      const client = new ElectronSessionHttpClient({ providerId: 'parkstay' });

      const cookies = await client.cookies.getAll('https://parkstay.dbca.wa.gov.au/');

      expect(ses.cookies.get).toHaveBeenCalledWith({ url: 'https://parkstay.dbca.wa.gov.au/' });
      expect(cookies).toEqual([
        expect.objectContaining({ name: 'a', hostOnly: true, expires: 1_800_000_000_000 }),
      ]);
    });

    it('set maps to ses.cookies.set, with a domain and expiry in seconds', async () => {
      const client = new ElectronSessionHttpClient({ providerId: 'parkstay' });

      await client.cookies.set({
        url: 'https://queue.dbca.wa.gov.au/',
        name: 'sitequeuesession',
        value: 'KEY',
        domain: 'dbca.wa.gov.au',
        expires: 1_800_000_000_000,
        sameSite: 'none',
      });

      expect(ses.cookies.set).toHaveBeenCalledWith({
        url: 'https://queue.dbca.wa.gov.au/',
        name: 'sitequeuesession',
        value: 'KEY',
        domain: 'dbca.wa.gov.au',
        path: '/',
        secure: undefined,
        httpOnly: undefined,
        expirationDate: 1_800_000_000,
        sameSite: 'no_restriction',
      });
    });

    it('clear removes every cookie in the partition through ses.cookies.remove', async () => {
      ses.cookies.get.mockResolvedValue([
        {
          name: 'sitequeuesession',
          value: 'x',
          domain: '.dbca.wa.gov.au',
          path: '/',
          secure: true,
        },
        {
          name: 'csrftoken',
          value: 'y',
          domain: 'parkstay.dbca.wa.gov.au',
          path: '/api',
          secure: false,
        },
      ]);
      const client = new ElectronSessionHttpClient({ providerId: 'parkstay' });

      await client.cookies.clear();

      expect(ses.cookies.get).toHaveBeenCalledWith({});
      expect(ses.cookies.remove.mock.calls).toEqual([
        ['https://dbca.wa.gov.au/', 'sitequeuesession'],
        ['http://parkstay.dbca.wa.gov.au/api', 'csrftoken'],
      ]);
    });
  });
});
