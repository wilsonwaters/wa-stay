/**
 * The renderer's Content Security Policy (architecture-notes §7, §12.25).
 *
 * Pure, with no electron import, so `vite.config.ts` can use it too:
 * - production: a Vite plugin writes it into the built `index.html` as the first
 *   `<meta http-equiv="Content-Security-Policy">` in `<head>` (a `file://` page has no
 *   response headers);
 * - development: `main-window.ts` sends it as a response header from the Vite dev server.
 *
 * It allows Mapbox GL JS v3 (tiles, styles and telemetry over https, blob: workers, data:
 * and blob: images) and any https image, so a new provider's photos need no change here.
 * Development adds what Vite needs: the inline React Refresh preamble and the dev server's
 * HTTP and WebSocket (HMR) connections.
 */

export type CspOptions =
  { readonly dev: false } | { readonly dev: true; readonly devOrigin: string };

const MAPBOX_CONNECT = [
  'https://api.mapbox.com',
  'https://events.mapbox.com',
  'https://*.tiles.mapbox.com',
];

export function buildCsp(options: CspOptions): string {
  const dev = options.dev ? devSources(options.devOrigin) : null;

  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", ...(dev ? ["'unsafe-inline'"] : [])]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', 'https:']],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', ["'self'", ...MAPBOX_CONNECT, ...(dev ? dev.connect : [])]],
    ['worker-src', ["'self'", 'blob:']],
    ['child-src', ['blob:']],
    ['frame-src', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'none'"]],
  ];

  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}

/** The dev server's own origin and its HMR WebSocket origin. */
function devSources(devOrigin: string): { connect: string[] } {
  let url: URL;
  try {
    url = new URL(devOrigin);
  } catch {
    throw new Error(`Invalid dev server origin: ${devOrigin}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Invalid dev server origin: ${devOrigin}`);
  }
  const socketProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return { connect: [url.origin, `${socketProtocol}//${url.host}`] };
}
