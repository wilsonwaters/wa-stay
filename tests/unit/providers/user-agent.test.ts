/**
 * The browser identity provider traffic presents (`providers/sdk/user-agent.ts`): Chromium's
 * own brand list (its GREASE algorithm, seeded by the major version), the user agent's and
 * `sec-ch-ua-platform`'s operating system, the languages and how Chromium writes them, and the
 * rewrite of a request's identity headers. `npm run test:electron` checks live that API calls
 * and a window on one partition send the same ones.
 */

import {
  ACCEPT_LANGUAGE,
  ACCEPT_LANGUAGES,
  acceptLanguageHeader,
  browserIdentity,
  CHROME_MAJOR_VERSION,
  CHROME_USER_AGENT,
  chromeUserAgent,
  chromiumBrands,
  formatBrands,
  greasedBrandList,
  platformTokens,
  runtimeChromeMajor,
  secChUaPlatform,
  withBrowserIdentity,
} from '@main/providers/sdk';

describe('chromiumBrands: the sec-ch-ua a Chromium with no brand of its own sends', () => {
  it.each([
    // Seen live: Electron 44's windows, and a stock Chromium 141 (Playwright's build)
    ['152', '"Not?A_Brand";v="24", "Chromium";v="152"'],
    ['141', '"Chromium";v="141", "Not?A_Brand";v="8"'],
  ])('Chromium %s: %s', (major, header) => {
    expect(chromiumBrands(major)).toBe(header);
  });

  it('never claims Google Chrome', () => {
    for (let major = 100; major <= 200; major++) {
      const brands = greasedBrandList(String(major));
      expect(brands.map((b) => b.brand)).toEqual(
        expect.arrayContaining(['Chromium', expect.stringMatching(/^Not.A.Brand$/)])
      );
      expect(brands).toHaveLength(2);
      expect(chromiumBrands(String(major))).not.toMatch(/Google Chrome/);
    }
  });
});

describe("greasedBrandList: Chromium's GREASE, checked against Google Chrome's published headers", () => {
  // The same algorithm with Chrome's embedder brand: the GREASE brand's characters and
  // version, and the order of the three, all follow from the major version.
  it.each([
    ['116', '"Chromium";v="116", "Not)A;Brand";v="24", "Google Chrome";v="116"'],
    ['120', '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"'],
    ['121', '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"'],
    ['124', '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"'],
    ['126', '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"'],
    ['128', '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"'],
    ['131', '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"'],
  ])('Chrome %s: %s', (major, header) => {
    expect(formatBrands(greasedBrandList(major, 'Google Chrome'))).toBe(header);
  });

  it('refuses a major version that is not a whole number', () => {
    expect(() => greasedBrandList('')).toThrow(TypeError);
    expect(() => greasedBrandList('152.0')).toThrow(TypeError);
    expect(() => greasedBrandList('-1')).toThrow(TypeError);
  });
});

describe('the operating system the identity names', () => {
  it.each([
    [
      'win32',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      '"Windows"',
    ],
    [
      'darwin',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      '"macOS"',
    ],
    [
      'linux',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      '"Linux"',
    ],
  ] as const)('%s: its user agent and sec-ch-ua-platform agree', (platform, userAgent, hint) => {
    expect(chromeUserAgent('152', platform)).toBe(userAgent);
    expect(secChUaPlatform(platform)).toBe(hint);
  });

  it('reads as Linux on an operating system the app does not ship for', () => {
    expect(platformTokens('freebsd')).toEqual(platformTokens('linux'));
  });

  it("defaults to the OS the app runs on, and Chrome's fixed version outside Electron", () => {
    expect(chromeUserAgent('152')).toBe(chromeUserAgent('152', process.platform));
    expect(secChUaPlatform()).toBe(secChUaPlatform(process.platform));
    expect(CHROME_USER_AGENT).toBe(chromeUserAgent(CHROME_MAJOR_VERSION, process.platform));
    expect(runtimeChromeMajor()).toBe(CHROME_MAJOR_VERSION); // no process.versions.chrome in Jest
  });
});

describe('Accept-Language', () => {
  it("is the app's languages, as Chromium writes them for session.setUserAgent", () => {
    expect(ACCEPT_LANGUAGES).toBe('en-AU,en,en-US');
    expect(ACCEPT_LANGUAGE).toBe('en-AU,en;q=0.9,en-US;q=0.8');
  });

  it('lowers the q-value by 0.1 for each language, never below 0.1', () => {
    expect(acceptLanguageHeader('fr')).toBe('fr');
    expect(acceptLanguageHeader('a,b,c,d,e,f,g,h,i,j,k,l')).toBe(
      'a,b;q=0.9,c;q=0.8,d;q=0.7,e;q=0.6,f;q=0.5,g;q=0.4,h;q=0.3,i;q=0.2,j;q=0.1,k;q=0.1,l;q=0.1'
    );
    expect(acceptLanguageHeader('')).toBe('');
  });
});

describe('browserIdentity', () => {
  it('is one browser: the Chromium version, its brand list, this OS, a desktop, the languages', () => {
    expect(browserIdentity({ chromeMajor: '152', platform: 'win32' })).toEqual({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      brands: '"Not?A_Brand";v="24", "Chromium";v="152"',
      platform: '"Windows"',
      mobile: '?0',
      acceptLanguage: 'en-AU,en;q=0.9,en-US;q=0.8',
      acceptLanguages: 'en-AU,en,en-US',
    });
    expect(browserIdentity()).toEqual(
      browserIdentity({ chromeMajor: runtimeChromeMajor(), platform: process.platform })
    );
    expect(browserIdentity().userAgent).toBe(CHROME_USER_AGENT);
  });
});

describe('withBrowserIdentity', () => {
  const identity = browserIdentity({ chromeMajor: '152', platform: 'linux' });

  it('rewrites the user agent always, and the client hints and languages a request carries', () => {
    const headers = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0',
      'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?1',
      'sec-ch-ua-platform': '"Windows"',
      'accept-language': 'en-US',
      referer: 'https://example.org/',
    };

    expect(withBrowserIdentity(headers, identity)).toEqual({
      'user-agent': identity.userAgent,
      'sec-ch-ua': '"Not?A_Brand";v="24", "Chromium";v="152"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Linux"',
      'accept-language': 'en-AU,en;q=0.9,en-US;q=0.8',
      referer: 'https://example.org/',
    });
    // The request's own headers are left as they were
    expect(headers['sec-ch-ua-platform']).toBe('"Windows"');
  });

  it('adds nothing but the user agent to a request without them', () => {
    expect(withBrowserIdentity({ accept: 'text/html' }, identity)).toEqual({
      accept: 'text/html',
      'user-agent': identity.userAgent,
    });
  });
});
