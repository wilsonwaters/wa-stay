/**
 * Build-time constants that Vite writes into the renderer bundle (`define` in vite.config.ts).
 * Undefined at run time anywhere else (Jest), so read them behind a `typeof` check.
 */

/** The public Mapbox token (`pk.…`), or an empty string when the build has none. */
declare const __MAPBOX_ACCESS_TOKEN__: string;
