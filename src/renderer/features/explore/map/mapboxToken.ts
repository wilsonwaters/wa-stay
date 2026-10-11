/**
 * The Mapbox access token. It is public by design (a `pk.` token with public scopes only):
 * `vite.config.ts` reads `MAPBOX_ACCESS_TOKEN` from the environment or the repo's `.env` at
 * build time and writes it into the bundle as `__MAPBOX_ACCESS_TOKEN__`. A secret `sk.` token
 * must never reach a bundle, so the build fails on one.
 */

/** The token as the renderer uses it: a `pk.` token, or null (Explore is then list-only). */
export function getMapboxToken(): string | null {
  // `typeof` keeps this safe where the build constant is not defined (Jest).
  const token = typeof __MAPBOX_ACCESS_TOKEN__ === 'string' ? __MAPBOX_ACCESS_TOKEN__ : '';
  return token.startsWith('pk.') ? token : null;
}

export const SECRET_TOKEN_MESSAGE =
  'MAPBOX_ACCESS_TOKEN is a secret (sk.) token. The renderer bundle is public: use a public ' +
  'pk. token with public scopes only.';

/**
 * Build time: the token to bundle. The process environment wins over `.env`, so CI's secret,
 * or `build:e2e`'s empty value, overrides a developer's file. Throws on a secret token.
 */
export function resolveMapboxToken(
  fromProcess: string | undefined,
  fromEnvFile: string | undefined
): string {
  const token = (fromProcess ?? fromEnvFile ?? '').trim();
  if (token.startsWith('sk.')) throw new Error(SECRET_TOKEN_MESSAGE);
  return token;
}
