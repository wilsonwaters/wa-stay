#!/usr/bin/env node
'use strict';

/**
 * Bundles the preload into one self-contained file, `dist/preload/index.js`.
 *
 * The main window runs with `sandbox: true` (architecture-notes §7). A sandboxed preload can
 * `require` only `electron` and a few polyfilled modules, so it cannot load sibling files
 * the way a `tsc` build would. esbuild inlines everything the preload imports (the zod-free
 * `shared/contracts/channels` module) and leaves `electron` as the one external `require`.
 *
 * After each build the metafile is checked: if the output imports anything other than
 * `electron`, the build fails and nothing is written. A Node built-in or a Node-only
 * dependency therefore fails the build, not the app at runtime.
 *
 *   node scripts/build-preload.js           build once (npm run build:preload)
 *   node scripts/build-preload.js --watch   rebuild on every change (npm run dev:preload)
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const PROJECT_ROOT = path.resolve(__dirname, '..');

/** The only modules the bundled preload may load at runtime. */
const ALLOWED_IMPORTS = ['electron'];

/** @type {import('esbuild').BuildOptions} */
const preloadBuildOptions = {
  absWorkingDir: PROJECT_ROOT,
  entryPoints: ['src/preload/index.ts'],
  outfile: 'dist/preload/index.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  // Electron 44 ships Chromium 152
  target: 'chrome152',
  external: ['electron'],
  sourcemap: 'linked',
  metafile: true,
  logLevel: 'warning',
};

/**
 * Every import in the build's outputs that the sandboxed preload could not load, as
 * `<output> imports <module>`. Empty when the outputs import only `electron`.
 *
 * @param {import('esbuild').Metafile} metafile
 * @returns {string[]}
 */
function findForbiddenImports(metafile) {
  return Object.entries(metafile.outputs).flatMap(([output, { imports }]) =>
    imports
      .filter((entry) => !ALLOWED_IMPORTS.includes(entry.path))
      .map((entry) => `${output} imports ${entry.path}`)
  );
}

/**
 * Throws when the build's outputs import anything other than `electron`.
 *
 * @param {import('esbuild').Metafile} metafile
 */
function assertPreloadImports(metafile) {
  const forbidden = findForbiddenImports(metafile);
  if (forbidden.length > 0) {
    throw new Error(
      `The sandboxed preload may import only ${ALLOWED_IMPORTS.join(', ')}:\n` +
        forbidden.map((line) => `  ${line}`).join('\n')
    );
  }
}

/**
 * esbuild runs with `write: false`; this plugin writes the outputs only when the import
 * check passes, so a rejected bundle never reaches `dist/preload/`.
 *
 * @returns {import('esbuild').Plugin}
 */
function checkThenWrite() {
  return {
    name: 'preload-import-check',
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length > 0 || !result.metafile || !result.outputFiles) return;
        try {
          assertPreloadImports(result.metafile);
        } catch (error) {
          // esbuild does not print errors returned from onEnd, so say why here
          console.error(`[build-preload] ${error.message}\nNothing was written.`);
          return { errors: [{ text: error.message }] };
        }
        for (const file of result.outputFiles) {
          fs.mkdirSync(path.dirname(file.path), { recursive: true });
          fs.writeFileSync(file.path, file.contents);
        }
        const bundle = result.outputFiles.find((file) => file.path.endsWith('.js'));
        const size = bundle ? `${(bundle.contents.length / 1024).toFixed(1)} KB` : '';
        console.log(`[build-preload] wrote ${preloadBuildOptions.outfile} ${size}`);
      });
    },
  };
}

const guardedOptions = () => ({
  ...preloadBuildOptions,
  write: false,
  plugins: [checkThenWrite()],
});

async function main(argv) {
  if (argv.includes('--watch')) {
    const context = await esbuild.context(guardedOptions());
    await context.watch();
    console.log('[build-preload] watching src/preload for changes');
    return;
  }
  await esbuild.build(guardedOptions());
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(() => {
    // Already reported: by esbuild (logLevel: 'warning') or by the import check above
    process.exit(1);
  });
}

module.exports = {
  ALLOWED_IMPORTS,
  preloadBuildOptions,
  findForbiddenImports,
  assertPreloadImports,
};
