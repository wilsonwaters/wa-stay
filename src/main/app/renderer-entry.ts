/**
 * Where the renderer is loaded from, and which URLs count as the app's own origin.
 *
 * The main window (`main-window.ts`) loads `resolveRendererEntry`, and both the IPC sender
 * guard and the window's navigation guard use `createAppUrlMatcher` on the same entry, so
 * they cannot disagree.
 */

import { pathToFileURL } from 'url';
import { runsFromSource, type AppSource } from './app-source';

export type RendererEntry =
  | { readonly kind: 'dev-server'; readonly url: string }
  | { readonly kind: 'file'; readonly path: string };

/** Default Vite dev server (`vite.config.ts`). `npm start` sets ELECTRON_RENDERER_URL to it. */
export const DEFAULT_DEV_SERVER_URL = 'http://localhost:3000';

/**
 * A packaged build always loads its own `index.html`: the dev-server variables are honoured
 * only when running from source (unpackaged and not loaded from an asar archive, so a packaged
 * executable renamed to `electron` still loads its own page; `app-source.ts`).
 */
export function resolveRendererEntry(
  env: NodeJS.ProcessEnv,
  builtIndexPath: string,
  source: AppSource
): RendererEntry {
  if (runsFromSource(source) && (env.ELECTRON_RENDERER_URL || env.NODE_ENV === 'development')) {
    return { kind: 'dev-server', url: env.ELECTRON_RENDERER_URL || DEFAULT_DEV_SERVER_URL };
  }
  return { kind: 'file', path: builtIndexPath };
}

/** True when `url` is a page of the app: same origin as the dev server, or the built index.html. */
export function createAppUrlMatcher(entry: RendererEntry): (url: string) => boolean {
  if (entry.kind === 'dev-server') {
    const origin = new URL(entry.url).origin;
    return (url) => parseUrl(url)?.origin === origin;
  }
  return createFileUrlMatcher(pathToFileURL(entry.path).href);
}

/**
 * Matches `file:` URLs of the same file as `expectedHref`, ignoring the hash and query (the
 * renderer routes in the hash). Percent-encoding differences and the case of a Windows
 * drive letter are ignored: Chromium may report `file:///c:/...` for `C:\...`.
 */
export function createFileUrlMatcher(expectedHref: string): (url: string) => boolean {
  const expected = fileKey(expectedHref);
  if (expected === null) throw new Error(`Not a file URL: ${expectedHref}`);
  return (url) => fileKey(url) === expected;
}

function fileKey(href: string): string | null {
  const url = parseUrl(href);
  if (!url || url.protocol !== 'file:') return null;
  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // keep the encoded form
  }
  pathname = pathname.replace(
    /^\/([A-Za-z]):/,
    (_match, drive: string) => `/${drive.toLowerCase()}:`
  );
  return `${url.host.toLowerCase()}|${pathname}`;
}

function parseUrl(href: string): URL | null {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}
