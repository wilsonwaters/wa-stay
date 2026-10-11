#!/usr/bin/env node
/**
 * `node scripts/serve-provider-site.mjs <id> [--port <n>] [--export <name>]`
 *
 * Serves a browser provider's made-up site, `tests/fixtures/providers/<id>/site.ts` (the one
 * its tests run on the fake browser), at `http://127.0.0.1:<port>`, so the app can preview the
 * provider with a real browser and nothing leaves this computer: point the provider's site
 * address at it for the preview ("Preview in the app" in docs/providers/browser-providers.md).
 * It prints each request the browser makes, and stops on Ctrl+C.
 *
 * - `--port`: the loopback port (default 8123; 0 picks a free one).
 * - `--export`: the site's export to serve. Default: the module's default export, else its one
 *   `render…Site` function (the scaffold's `render<Name>Site`), else its one function or route
 *   map.
 *
 * The site module is bundled with esbuild (TypeScript, the `@tests`, `@main` and `@shared`
 * aliases) and served by `serveFakeSite` (`tests/utils/fake-site.ts`), which answers exactly as
 * the fake browser does. Plain loopback HTTP: no certificate, and only this computer can reach
 * it.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import esbuild from 'esbuild';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** The registry's provider id rule (`PROVIDER_ID_PATTERN`, src/shared/types/provider.types.ts). */
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const DEFAULT_PORT = 8123;

const USAGE = `Usage: node scripts/serve-provider-site.mjs <id> [--port <n>] [--export <name>]

  <id>             The browser provider whose tests/fixtures/providers/<id>/site.ts to serve.
  --port <n>       The loopback port (default ${DEFAULT_PORT}; 0 picks a free one).
  --export <name>  The site's export to serve (default: found as the scaffold names it).`;

class UsageError extends Error {}

function parse(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        port: { type: 'string' },
        export: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error.message);
  }
  const { values, positionals } = parsed;
  if (values.help) return { help: true };
  if (positionals.length !== 1) throw new UsageError('Give exactly one provider id.');
  const [id] = positionals;
  if (!PROVIDER_ID_PATTERN.test(id)) throw new UsageError(`"${id}" is not a provider id.`);
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`--port must be a port number, not "${values.port}".`);
  }
  return { id, port, exportName: values.export };
}

/** Bundles the site and the server into one CommonJS module, and loads it. */
async function load(siteFile) {
  const serverFile = path.join(REPO, 'tests', 'utils', 'fake-site.ts');
  const entry = [
    `export * as site from ${JSON.stringify(siteFile)};`,
    `export { serveFakeSite } from ${JSON.stringify(serverFile)};`,
  ].join('\n');
  const result = await esbuild.build({
    stdin: { contents: entry, resolveDir: REPO, loader: 'ts', sourcefile: 'serve-site-entry.ts' },
    absWorkingDir: REPO,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    alias: { '@tests': './tests', '@main': './src/main', '@shared': './src/shared' },
    write: false,
    logLevel: 'silent',
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-site-'));
  const file = path.join(dir, 'site.cjs');
  try {
    fs.writeFileSync(file, result.outputFiles[0].text);
    return require(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const isSite = (value) =>
  typeof value === 'function' || (value !== null && typeof value === 'object');

/** The export to serve, by `--export`, else as the scaffold names it. */
function siteExport(module, exportName, relFile) {
  const names = Object.keys(module).filter((name) => name !== '__esModule');
  if (exportName) {
    if (!isSite(module[exportName])) {
      throw new UsageError(
        `${relFile} has no export "${exportName}" to serve (it has: ${names.join(', ')}).`
      );
    }
    return exportName;
  }
  if (isSite(module.default)) return 'default';
  const renderers = names.filter((name) => /^render\w*Site$/.test(name) && isSite(module[name]));
  if (renderers.length === 1) return renderers[0];
  const sites = names.filter((name) => isSite(module[name]));
  if (sites.length === 1) return sites[0];
  throw new UsageError(
    `${relFile}: say which export is the site with --export (it has: ${names.join(', ') || 'none'}).`
  );
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const { id, port, exportName } = options;
  const relFile = `tests/fixtures/providers/${id}/site.ts`;
  const siteFile = path.join(REPO, ...relFile.split('/'));
  if (!fs.existsSync(siteFile)) {
    throw new UsageError(
      `${relFile} does not exist. Only a browser provider has a made-up site; an API provider is previewed with the preview spec (PREVIEW_PROVIDER=${id}).`
    );
  }

  const bundle = await load(siteFile);
  const name = siteExport(bundle.site, exportName, relFile);
  const server = await bundle.serveFakeSite(bundle.site[name], {
    port,
    onRequest: (request, response) => {
      const { pathname, search } = request.url;
      console.log(`${request.method} ${pathname}${search} ${response.status}`);
    },
  });
  const constant = `${id.split('-').join('_').toUpperCase()}_SITE_URL`;
  console.log(`Serving ${relFile} (${name}) at ${server.baseUrl}
Only this computer can reach it. For the preview, point the provider's site address at it (a
generated provider's is ${constant} in src/main/providers/${id}/index.ts), and set it back
afterwards. Press Ctrl+C to stop.`);

  const stop = () => {
    void server.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch((error) => {
  if (error instanceof UsageError) {
    console.error(`serve-provider-site: ${error.message}\n\n${USAGE}`);
  } else if (error?.code === 'EADDRINUSE') {
    console.error(`serve-provider-site: port ${error.port} is in use: choose another with --port.`);
  } else {
    console.error(`serve-provider-site: ${error?.stack ?? error}`);
  }
  process.exitCode = 1;
});
