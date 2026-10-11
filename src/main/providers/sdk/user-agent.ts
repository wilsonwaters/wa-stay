/**
 * The browser identity provider traffic uses. Some providers block library user agents
 * (ParkStay's queue middleware answers HTTP-library and scripting-language user agents with a
 * queue redirect page), so provider sessions present a desktop Chrome user agent, never a
 * library default.
 *
 * - `NodeHttpClient` (tests) sends `CHROME_USER_AGENT`, a fixed Chrome version.
 * - The Electron provider partition (its `ElectronSessionHttpClient` and its sign-in and
 *   payment windows) presents the Chrome version Electron really runs
 *   (`process.versions.chrome`), so the user agent agrees with the client hints Chromium
 *   sends from the windows (architecture-notes §12.32).
 */

export const CHROME_MAJOR_VERSION = '131';

/** A desktop Chrome (Windows) user agent for Chrome `major`. */
export function chromeUserAgent(major: string): string {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/** The `sec-ch-ua` brand list Chrome `major` sends. */
export function chromeBrands(major: string): string {
  return `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not_A Brand";v="24"`;
}

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
