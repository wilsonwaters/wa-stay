/**
 * The browser identity provider traffic presents. Some providers block library user agents
 * (ParkStay's queue middleware answers HTTP-library and scripting-language user agents with a
 * queue redirect page), so provider sessions present a desktop Chromium user agent, never a
 * library default.
 *
 * Every part of it is what the provider's own windows send on the same partition, so API calls
 * and windows present one browser. It is fixed (it changes only with the Chromium an app update
 * brings) and never rotated or varied (architecture-notes §12.32):
 * - **User agent:** desktop Chrome's reduced form, at the Chromium version Electron runs
 *   (`process.versions.chrome`), with the platform token of the operating system the app runs
 *   on (`process.platform`).
 * - **`sec-ch-ua`:** the brand list Chromium itself sends for that version
 *   (`chromiumBrands`): `"Chromium"` and a GREASE brand, no `"Google Chrome"`, as Electron has
 *   no brand of its own.
 * - **`sec-ch-ua-platform`** names the same operating system, and **`sec-ch-ua-mobile`** says a
 *   desktop (`?0`).
 * - **`Accept-Language`:** `ACCEPT_LANGUAGES`, which the partition is given with its user agent
 *   (`session.setUserAgent`) and which Chromium turns into `ACCEPT_LANGUAGE`.
 *
 * `NodeHttpClient` (tests) sends `CHROME_USER_AGENT`, the same form at a fixed version.
 */

/** The Chromium major version presented outside Electron (tests). */
export const CHROME_MAJOR_VERSION = '131';

export interface PlatformTokens {
  /** The user agent's platform token. */
  userAgent: string;
  /** The `sec-ch-ua-platform` header's value. */
  secChUaPlatform: string;
}

const WINDOWS: PlatformTokens = {
  userAgent: 'Windows NT 10.0; Win64; x64',
  secChUaPlatform: '"Windows"',
};
const MACOS: PlatformTokens = {
  userAgent: 'Macintosh; Intel Mac OS X 10_15_7',
  secChUaPlatform: '"macOS"',
};
const LINUX: PlatformTokens = { userAgent: 'X11; Linux x86_64', secChUaPlatform: '"Linux"' };

/**
 * What Chromium says about the operating system `platform` (a `process.platform` value). The
 * user agent's token is the reduced, frozen one (macOS 10_15_7 and x86_64 on any version and
 * architecture). The app ships for Windows, macOS and Linux; anything else reads as Linux.
 */
export function platformTokens(platform: NodeJS.Platform = process.platform): PlatformTokens {
  if (platform === 'win32') return WINDOWS;
  if (platform === 'darwin') return MACOS;
  return LINUX;
}

/** The `sec-ch-ua-platform` value for `platform`: `"Windows"`, `"macOS"` or `"Linux"`. */
export function secChUaPlatform(platform: NodeJS.Platform = process.platform): string {
  return platformTokens(platform).secChUaPlatform;
}

/** A desktop Chrome user agent for Chromium `major` on `platform`. */
export function chromeUserAgent(
  major: string,
  platform: NodeJS.Platform = process.platform
): string {
  return `Mozilla/5.0 (${platformTokens(platform).userAgent}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

export interface BrandVersion {
  brand: string;
  version: string;
}

// Chromium's GREASE for the brand list (components/embedder_support/user_agent_utils.cc,
// `GenerateBrandVersionList` and `GetGreasedUserAgentBrandVersion`, the updated algorithm).
const GREASEY_CHARS = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
const GREASED_VERSIONS = ['8', '99', '24'];
const BRAND_ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
] as const;

/**
 * The brand list Chromium `major` sends, as Chromium works it out: the major version is the
 * seed for the GREASE brand's two characters (`Not?A_Brand`), its version (8, 99 or 24) and the
 * order. Without an embedder `brand` (Electron, a plain Chromium) the list is the GREASE brand
 * and `"Chromium"`; with one (Google Chrome's `"Google Chrome"`, which the app never passes) it
 * has three entries in one of six orders.
 */
export function greasedBrandList(major: string, brand?: string): BrandVersion[] {
  if (!/^\d+$/.test(major)) throw new TypeError(`Not a Chromium major version: ${major}`);
  const seed = Number(major);
  const grease: BrandVersion = {
    brand: `Not${GREASEY_CHARS[seed % GREASEY_CHARS.length]}A${GREASEY_CHARS[(seed + 1) % GREASEY_CHARS.length]}Brand`,
    version: GREASED_VERSIONS[seed % GREASED_VERSIONS.length],
  };
  const chromium: BrandVersion = { brand: 'Chromium', version: major };
  const list: BrandVersion[] = [];
  if (brand === undefined) {
    list[seed % 2] = grease;
    list[(seed + 1) % 2] = chromium;
    return list;
  }
  const order = BRAND_ORDERS[seed % BRAND_ORDERS.length];
  list[order[0]] = grease;
  list[order[1]] = chromium;
  list[order[2]] = { brand, version: major };
  return list;
}

/** A brand list as the `sec-ch-ua` header writes it. */
export function formatBrands(brands: readonly BrandVersion[]): string {
  return brands.map(({ brand, version }) => `"${brand}";v="${version}"`).join(', ');
}

/**
 * The `sec-ch-ua` Electron's Chromium `major` sends from a window, and so what API calls send:
 * `"Not?A_Brand";v="24", "Chromium";v="152"` for Chromium 152 (Electron 44).
 */
export function chromiumBrands(major: string): string {
  return formatBrands(greasedBrandList(major));
}

/**
 * The languages provider traffic asks for, most wanted first, in the form
 * `session.setUserAgent` takes. The partition's windows and API calls both send them.
 */
export const ACCEPT_LANGUAGES = 'en-AU,en,en-US';

/**
 * The `Accept-Language` header Chromium makes of a language list
 * (`net::HttpUtil::GenerateAcceptLanguageHeader`): the first with no q-value, then
 * `;q=0.9`, `;q=0.8` and so on, never below 0.1.
 */
export function acceptLanguageHeader(languages: string): string {
  let q = 10;
  const parts: string[] = [];
  for (const language of languages.split(',').filter((token) => token.length > 0)) {
    parts.push(q === 10 ? language : `${language};q=0.${q}`);
    if (q > 1) q -= 1;
  }
  return parts.join(',');
}

/** `ACCEPT_LANGUAGES` as the header: `en-AU,en;q=0.9,en-US;q=0.8`. */
export const ACCEPT_LANGUAGE = acceptLanguageHeader(ACCEPT_LANGUAGES);

/** The user agent `NodeHttpClient` (tests) sends: Chrome `CHROME_MAJOR_VERSION` on this OS. */
export const CHROME_USER_AGENT = chromeUserAgent(CHROME_MAJOR_VERSION);

/**
 * The major version of the Chromium this process runs (`152` in Electron 44), or
 * `CHROME_MAJOR_VERSION` outside Electron.
 */
export function runtimeChromeMajor(
  versions: Partial<Record<string, string | undefined>> = process.versions
): string {
  const major = /^(\d+)\./.exec(versions.chrome ?? '')?.[1];
  return major ?? CHROME_MAJOR_VERSION;
}

/** One browser, as its headers say it. */
export interface BrowserIdentity {
  /** `User-Agent`. */
  userAgent: string;
  /** `sec-ch-ua`. */
  brands: string;
  /** `sec-ch-ua-platform`. */
  platform: string;
  /** `sec-ch-ua-mobile`: a desktop. */
  mobile: '?0';
  /** `Accept-Language`. */
  acceptLanguage: string;
  /** The language list `session.setUserAgent` takes, which Chromium turns into `acceptLanguage`. */
  acceptLanguages: string;
}

export interface BrowserIdentityOptions {
  /** Defaults to the Chromium this process runs (`runtimeChromeMajor`). */
  chromeMajor?: string;
  /** Defaults to the operating system the app runs on. Tests only. */
  platform?: NodeJS.Platform;
}

/** The browser provider traffic presents: Electron's Chromium on this operating system. */
export function browserIdentity({
  chromeMajor = runtimeChromeMajor(),
  platform = process.platform,
}: BrowserIdentityOptions = {}): BrowserIdentity {
  return {
    userAgent: chromeUserAgent(chromeMajor, platform),
    brands: chromiumBrands(chromeMajor),
    platform: secChUaPlatform(platform),
    mobile: '?0',
    acceptLanguage: ACCEPT_LANGUAGE,
    acceptLanguages: ACCEPT_LANGUAGES,
  };
}

/**
 * `headers` (lower-case names) as `identity` sends them: the `user-agent` always, and
 * `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform` and `accept-language` when the request
 * already has them. Nothing is added that the request did not carry.
 */
export function withBrowserIdentity(
  headers: Record<string, string>,
  identity: BrowserIdentity
): Record<string, string> {
  const out: Record<string, string> = { ...headers, 'user-agent': identity.userAgent };
  const sentOnly: Array<[string, string]> = [
    ['sec-ch-ua', identity.brands],
    ['sec-ch-ua-mobile', identity.mobile],
    ['sec-ch-ua-platform', identity.platform],
    ['accept-language', identity.acceptLanguage],
  ];
  for (const [name, value] of sentOnly) {
    if (name in out) out[name] = value;
  }
  return out;
}
