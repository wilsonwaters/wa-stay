import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { buildCsp } from './src/main/app/csp';
import { resolveMapboxToken } from './src/renderer/features/explore/map/mapboxToken';

/**
 * Production CSP (architecture-notes §12.25). The built renderer loads from `file://`, which
 * has no response headers, so the policy goes into `index.html` as the first element of
 * `<head>`. The dev server gets the dev policy as a header from the main process instead.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'wa-stay-content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: buildCsp({ dev: false }) },
          injectTo: 'head-prepend',
        },
      ],
    },
  };
}

export default defineConfig(({ mode }) => {
  // The root is src/renderer, so the repo-root `.env` is loaded explicitly. The third argument
  // ('') loads every key, but only the Mapbox token is used, and only through `define`:
  // nothing is exposed through `envPrefix`.
  const env = loadEnv(mode, __dirname, '');
  // The process environment wins (CI's secret, or build:e2e's empty value); a secret `sk.`
  // token fails the build.
  const mapboxToken = resolveMapboxToken(process.env.MAPBOX_ACCESS_TOKEN, env.MAPBOX_ACCESS_TOKEN);

  return {
    plugins: [react(), contentSecurityPolicy()],
    base: './',
    root: './src/renderer',
    define: {
      __MAPBOX_ACCESS_TOKEN__: JSON.stringify(mapboxToken),
    },
    build: {
      outDir: '../../dist/renderer',
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@renderer': path.resolve(__dirname, './src/renderer'),
        '@shared': path.resolve(__dirname, './src/shared'),
      },
    },
    server: {
      port: 3000,
    },
  };
});
