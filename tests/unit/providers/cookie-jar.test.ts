/**
 * CookieJar (NodeHttpClient's in-memory store): RFC 6265 parsing and matching.
 */

import { CookieJar } from '@main/providers/sdk/http-node';

const QUEUE = 'https://queue.dbca.wa.gov.au/api/check-create-session/';
const T0 = Date.parse('2026-10-02T00:00:00Z');

describe('CookieJar', () => {
  let now: number;
  let jar: CookieJar;

  beforeEach(() => {
    now = T0;
    jar = new CookieJar(() => now);
  });

  it('keeps everything after the first "=" as the value (sitequeuesession=AB=C==)', async () => {
    jar.setCookie('sitequeuesession=AB=C==; Domain=dbca.wa.gov.au; Path=/', QUEUE);

    expect(await jar.get('https://queue.dbca.wa.gov.au/api/x', 'sitequeuesession')).toMatchObject({
      name: 'sitequeuesession',
      value: 'AB=C==',
      domain: 'dbca.wa.gov.au',
      hostOnly: false,
      path: '/',
    });
  });

  it('sends a domain cookie to the domain and its subdomains, not elsewhere', () => {
    jar.setCookie('sitequeuesession=AB=C==; Domain=dbca.wa.gov.au; Path=/', QUEUE);

    expect(jar.cookieHeader('https://queue.dbca.wa.gov.au/api/x')).toBe('sitequeuesession=AB=C==');
    expect(jar.cookieHeader('https://parkstay.dbca.wa.gov.au/')).toBe('sitequeuesession=AB=C==');
    expect(jar.cookieHeader('https://dbca.wa.gov.au/')).toBe('sitequeuesession=AB=C==');
    expect(jar.cookieHeader('https://example.com/')).toBe('');
    expect(jar.cookieHeader('https://notdbca.wa.gov.au/')).toBe('');
  });

  it('ignores a leading dot on Domain', () => {
    jar.setCookie('a=1; Domain=.dbca.wa.gov.au; Path=/', QUEUE);
    expect(jar.cookieHeader('https://parkstay.dbca.wa.gov.au/')).toBe('a=1');
  });

  it('keeps a host-only cookie (no Domain) off subdomains and siblings', () => {
    jar.setCookie('csrftoken=xyz; Path=/', 'https://parkstay.dbca.wa.gov.au/api/profile');

    expect(jar.cookieHeader('https://parkstay.dbca.wa.gov.au/booking/')).toBe('csrftoken=xyz');
    expect(jar.cookieHeader('https://www.parkstay.dbca.wa.gov.au/')).toBe('');
    expect(jar.cookieHeader('https://queue.dbca.wa.gov.au/')).toBe('');
  });

  it('rejects a Domain that does not cover the host that set it', () => {
    jar.setCookie('evil=1; Domain=example.com', QUEUE);
    expect(jar.cookieHeader('https://example.com/')).toBe('');
  });

  it('deletes a cookie on Max-Age=0', () => {
    jar.setCookie('sessionid=abc; Path=/', 'https://parkstay.dbca.wa.gov.au/');
    jar.setCookie('sessionid=; Path=/; Max-Age=0', 'https://parkstay.dbca.wa.gov.au/');

    expect(jar.cookieHeader('https://parkstay.dbca.wa.gov.au/')).toBe('');
  });

  it('does not send a cookie whose Expires is in the past', () => {
    jar.setCookie(
      'old=1; Expires=Wed, 01 Jan 2020 00:00:00 GMT',
      'https://parkstay.dbca.wa.gov.au/'
    );
    expect(jar.cookieHeader('https://parkstay.dbca.wa.gov.au/')).toBe('');
  });

  it('stops sending a cookie once it expires, and Max-Age wins over Expires', () => {
    jar.setCookie(
      'short=1; Max-Age=60; Expires=Fri, 01 Jan 2100 00:00:00 GMT',
      'https://parkstay.dbca.wa.gov.au/'
    );
    expect(jar.cookieHeader('https://parkstay.dbca.wa.gov.au/')).toBe('short=1');

    now = T0 + 61_000;
    expect(jar.cookieHeader('https://parkstay.dbca.wa.gov.au/')).toBe('');
  });

  it('sends a Secure cookie over https only', () => {
    jar.setCookie('s=1; Secure', 'https://parkstay.dbca.wa.gov.au/');
    expect(jar.cookieHeader('https://parkstay.dbca.wa.gov.au/')).toBe('s=1');
    expect(jar.cookieHeader('http://parkstay.dbca.wa.gov.au/')).toBe('');
  });

  it('accepts SameSite=None without Secure (tests only)', async () => {
    jar.setCookie('lax=1; SameSite=None', 'http://127.0.0.1/');
    expect(await jar.get('http://127.0.0.1/', 'lax')).toMatchObject({
      sameSite: 'none',
      secure: false,
    });
  });

  it('matches paths on segment boundaries and uses the default path', () => {
    jar.setCookie('api=1; Path=/api', 'https://parkstay.dbca.wa.gov.au/');
    jar.setCookie('dflt=1', 'https://parkstay.dbca.wa.gov.au/booking/step');

    expect(jar.cookieHeader('https://parkstay.dbca.wa.gov.au/api')).toBe('api=1');
    expect(jar.cookieHeader('https://parkstay.dbca.wa.gov.au/api/x')).toBe('api=1');
    expect(jar.cookieHeader('https://parkstay.dbca.wa.gov.au/apix')).toBe('');
    expect(jar.cookieHeader('https://parkstay.dbca.wa.gov.au/booking/other')).toBe('dflt=1');
    expect(jar.cookieHeader('https://parkstay.dbca.wa.gov.au/')).toBe('');
  });

  it('replaces a cookie with the same name, domain and path, and orders longer paths first', () => {
    jar.setCookie('a=1; Path=/', 'https://parkstay.dbca.wa.gov.au/');
    jar.setCookie('b=2; Path=/api', 'https://parkstay.dbca.wa.gov.au/');
    jar.setCookie('a=3; Path=/', 'https://parkstay.dbca.wa.gov.au/');

    expect(jar.cookieHeader('https://parkstay.dbca.wa.gov.au/api/x')).toBe('b=2; a=3');
  });

  it('ignores a header without a name=value pair', () => {
    jar.setCookie('garbage', 'https://parkstay.dbca.wa.gov.au/');
    jar.setCookie('=novalue', 'https://parkstay.dbca.wa.gov.au/');
    expect(jar.cookieHeader('https://parkstay.dbca.wa.gov.au/')).toBe('');
  });

  it('implements CookieStore: set, getAll and clear', async () => {
    await jar.set({
      url: 'https://queue.dbca.wa.gov.au/',
      name: 'sitequeuesession',
      value: 'KEY',
      domain: 'dbca.wa.gov.au',
    });
    await jar.set({ url: 'https://parkstay.dbca.wa.gov.au/', name: 'host', value: 'only' });

    expect((await jar.getAll('https://parkstay.dbca.wa.gov.au/')).map((c) => c.name)).toEqual([
      'sitequeuesession',
      'host',
    ]);
    expect((await jar.getAll('https://queue.dbca.wa.gov.au/')).map((c) => c.name)).toEqual([
      'sitequeuesession',
    ]);

    await jar.clear();
    expect(await jar.getAll('https://parkstay.dbca.wa.gov.au/')).toEqual([]);
  });
});
