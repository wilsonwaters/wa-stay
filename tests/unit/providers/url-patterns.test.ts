/**
 * URL allow-lists for provider windows: exact and wildcard origin patterns (and the tricks a
 * page could use to look allowed), completion URL patterns, pattern validation, and the
 * origin-only form URLs take in logs.
 */

import {
  describeUrl,
  isHttpsOriginPattern,
  isHttpsUrlPattern,
  matchesOrigin,
  matchesUrlPattern,
} from '@main/providers/sdk';

const SIGN_IN = ['https://parkstay.dbca.wa.gov.au', 'https://dbcab2c.b2clogin.com'];
const PAYMENT = ['https://parkstay.dbca.wa.gov.au', 'https://*.dbca.wa.gov.au'];

describe('matchesOrigin', () => {
  it('matches an exact origin, whatever the path, query or case of the host', () => {
    expect(matchesOrigin('https://parkstay.dbca.wa.gov.au/ssologin', SIGN_IN)).toBe(true);
    expect(matchesOrigin('https://DBCAB2C.b2clogin.com/x/y?z=1#h', SIGN_IN)).toBe(true);
    expect(matchesOrigin('https://parkstay.dbca.wa.gov.au:443/', SIGN_IN)).toBe(true);
  });

  it('refuses another host, another port, http and non-web schemes', () => {
    expect(matchesOrigin('https://evil.example/', SIGN_IN)).toBe(false);
    expect(matchesOrigin('https://parkstay.dbca.wa.gov.au:8443/', SIGN_IN)).toBe(false);
    expect(matchesOrigin('http://parkstay.dbca.wa.gov.au/', SIGN_IN)).toBe(false);
    expect(matchesOrigin('javascript:alert(1)', SIGN_IN)).toBe(false);
    expect(matchesOrigin('file:///etc/passwd', SIGN_IN)).toBe(false);
    expect(matchesOrigin('not a url', SIGN_IN)).toBe(false);
  });

  it('refuses a URL with a user name or password, even one whose host is allowed', () => {
    expect(matchesOrigin('https://parkstay.dbca.wa.gov.au@evil.example/', SIGN_IN)).toBe(false);
    expect(matchesOrigin('https://user:pw@parkstay.dbca.wa.gov.au/', SIGN_IN)).toBe(false);
  });

  it('a wildcard matches subdomains at any depth, never the domain itself', () => {
    expect(matchesOrigin('https://queue.dbca.wa.gov.au/x', PAYMENT)).toBe(true);
    expect(matchesOrigin('https://a.b.dbca.wa.gov.au/', PAYMENT)).toBe(true);
    expect(matchesOrigin('https://dbca.wa.gov.au/', PAYMENT)).toBe(false);
  });

  it('a wildcard refuses look-alike hosts, other ports and http', () => {
    expect(matchesOrigin('https://evildbca.wa.gov.au/', PAYMENT)).toBe(false);
    expect(matchesOrigin('https://dbca.wa.gov.au.evil.example/', PAYMENT)).toBe(false);
    expect(matchesOrigin('https://x.dbca.wa.gov.au:8443/', PAYMENT)).toBe(false);
    expect(matchesOrigin('http://x.dbca.wa.gov.au/', PAYMENT)).toBe(false);
  });

  it('allows http only for an exact loopback origin (live tests)', () => {
    expect(matchesOrigin('http://127.0.0.1:4100/a', ['http://127.0.0.1:4100'])).toBe(true);
    expect(matchesOrigin('http://127.0.0.1:4101/a', ['http://127.0.0.1:4100'])).toBe(false);
    expect(matchesOrigin('http://example.com/', ['http://example.com'])).toBe(false);
  });

  it('nothing matches an empty list', () => {
    expect(matchesOrigin('https://parkstay.dbca.wa.gov.au/', [])).toBe(false);
  });
});

describe('matchesUrlPattern', () => {
  const DONE = ['https://parkstay.dbca.wa.gov.au/login-success/*'];

  it('* matches any text, including none, and the query', () => {
    expect(matchesUrlPattern('https://parkstay.dbca.wa.gov.au/login-success/', DONE)).toBe(true);
    expect(matchesUrlPattern('https://parkstay.dbca.wa.gov.au/login-success/?a=1', DONE)).toBe(
      true
    );
  });

  it('is anchored at both ends and treats . and ? literally', () => {
    expect(matchesUrlPattern('https://parkstay.dbca.wa.gov.au/login-success', DONE)).toBe(false);
    expect(
      matchesUrlPattern('https://evil.example/https://parkstay.dbca.wa.gov.au/login-success/', DONE)
    ).toBe(false);
    expect(matchesUrlPattern('https://parkstayXdbca.wa.gov.au/login-success/', DONE)).toBe(false);
    expect(
      matchesUrlPattern('https://parkstay.dbca.wa.gov.au@evil.example/login-success/', DONE)
    ).toBe(false);
  });
});

describe('pattern validation (the registry uses it)', () => {
  it('origin patterns: exact https origins or https://*.<domain of 2+ labels>', () => {
    expect(isHttpsOriginPattern('https://parkstay.dbca.wa.gov.au')).toBe(true);
    expect(isHttpsOriginPattern('https://*.dbca.wa.gov.au')).toBe(true);
    expect(isHttpsOriginPattern('https://parkstay.dbca.wa.gov.au/')).toBe(false);
    expect(isHttpsOriginPattern('http://parkstay.dbca.wa.gov.au')).toBe(false);
    expect(isHttpsOriginPattern('https://*.au')).toBe(false);
    expect(isHttpsOriginPattern('https://*')).toBe(false);
    expect(isHttpsOriginPattern(42)).toBe(false);
  });

  it('URL patterns: https and a URL once the wildcards are filled in', () => {
    expect(isHttpsUrlPattern('https://parkstay.dbca.wa.gov.au/login-success/*')).toBe(true);
    expect(isHttpsUrlPattern('http://parkstay.dbca.wa.gov.au/*')).toBe(false);
    expect(isHttpsUrlPattern('/login-success/*')).toBe(false);
    expect(isHttpsUrlPattern(undefined)).toBe(false);
  });
});

describe('describeUrl', () => {
  it('gives only the origin of a web URL: never a path, query or token', () => {
    expect(
      describeUrl('https://dbcab2c.b2clogin.com/dbcab2c.onmicrosoft.com/link?token=SECRET')
    ).toBe('https://dbcab2c.b2clogin.com');
    expect(describeUrl('javascript:alert(1)')).toBe('a javascript: URL');
    expect(describeUrl('::')).toBe('an invalid URL');
  });
});
