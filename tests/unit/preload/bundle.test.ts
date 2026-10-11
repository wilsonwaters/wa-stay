/**
 * The bundled preload (`scripts/build-preload.js`): one self-contained file that a sandboxed
 * renderer can run.
 *
 * - The metafile check rejects any output that imports something other than `electron`.
 * - The real preload, bundled in memory with the build's own options, runs in a bare `vm`
 *   context (no `process`, no `Buffer`, a `require` that serves only `electron`) and exposes
 *   the whole contract as `window.api`.
 * - The bundle carries channel names only: no zod.
 */

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { build, BuildResult, OutputFile } from 'esbuild';
import { contract } from '@shared/contracts';
import {
  assertPreloadImports,
  findForbiddenImports,
  preloadBuildOptions,
} from '../../../scripts/build-preload';

const ROOT = path.resolve(__dirname, '../../..');

/** Builds `contents` in memory with the preload options, importing from the preload's folder. */
async function bundleSnippet(contents: string, external: string[]): Promise<BuildResult> {
  const { entryPoints: _entryPoints, ...options } = preloadBuildOptions;
  return build({
    ...options,
    stdin: { contents, resolveDir: path.join(ROOT, 'src/preload'), loader: 'ts' },
    external,
    write: false,
    logLevel: 'silent',
  });
}

/** The real preload, bundled in memory with exactly the build options. */
async function bundlePreload(): Promise<{ result: BuildResult; js: OutputFile }> {
  const result = await build({ ...preloadBuildOptions, write: false, logLevel: 'silent' });
  const js = result.outputFiles?.find((file) => path.basename(file.path) === 'index.js');
  if (!js) throw new Error('The preload build produced no index.js');
  return { result, js };
}

describe('preload build options', () => {
  it('bundles src/preload/index.ts to dist/preload/index.js for Chromium 152, electron external', () => {
    expect(preloadBuildOptions).toEqual(
      expect.objectContaining({
        entryPoints: ['src/preload/index.ts'],
        outfile: 'dist/preload/index.js',
        bundle: true,
        format: 'cjs',
        platform: 'browser',
        target: 'chrome152',
        external: ['electron'],
        sourcemap: 'linked',
        metafile: true,
      })
    );
  });
});

describe('build pipeline', () => {
  const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));

  it('the bundle lands where the main process loads it: ../../preload/index.js from dist/main/main/', () => {
    const mainDir = path.dirname(path.join(ROOT, readJson('package.json').main));
    expect(path.join(mainDir, '../../preload/index.js')).toBe(
      path.join(ROOT, preloadBuildOptions.outfile as string)
    );
  });

  it('npm run build and npm run dev include the preload; tsc no longer emits one', () => {
    const { scripts } = readJson('package.json');
    expect(scripts['build:preload']).toBe('node scripts/build-preload.js');
    expect(scripts['dev:preload']).toBe('node scripts/build-preload.js --watch');
    // After emptying dist/ (scripts/clean-dist.js, tests/scripts/clean-dist.test.ts)
    expect(scripts.build).toBe(
      'node scripts/clean-dist.js && npm run build:main && npm run build:preload && npm run build:renderer'
    );
    expect(scripts.dev).toContain('npm run dev:preload');

    // The main build skips src/preload; type-check still covers it through tsconfig.json
    expect(readJson('tsconfig.main.json').include).not.toContainEqual(
      expect.stringContaining('src/preload')
    );
    expect(readJson('tsconfig.json').include).toContain('src/preload/**/*');
  });
});

describe('metafile import check', () => {
  it('rejects an output that imports fs', async () => {
    const { metafile } = await bundleSnippet(
      "import { readFileSync } from 'fs';\nimport { ipcRenderer } from 'electron';\n" +
        'export const read = () => [readFileSync, ipcRenderer];',
      ['electron', 'fs']
    );

    expect(findForbiddenImports(metafile)).toEqual([expect.stringMatching(/ imports fs$/)]);
    expect(() => assertPreloadImports(metafile)).toThrow(/may import only electron[\s\S]*fs/);
  });

  it('accepts an output that imports only electron', async () => {
    const { metafile } = await bundleSnippet(
      "import { ipcRenderer } from 'electron';\nexport const api = { ipcRenderer };",
      ['electron']
    );

    expect(findForbiddenImports(metafile)).toEqual([]);
    expect(() => assertPreloadImports(metafile)).not.toThrow();
  });

  it('a Node built-in that is not marked external fails the bundle itself', async () => {
    await expect(
      bundleSnippet("import path from 'path';\nexport const join = path.join;", ['electron'])
    ).rejects.toThrow(/Could not resolve "path"/);
  });
});

describe('bundled preload in a sandbox-like vm context', () => {
  let js: OutputFile;
  let metafile: BuildResult['metafile'];
  let exposeInMainWorld: jest.Mock;
  let invoke: jest.Mock;
  let required: string[];

  beforeAll(async () => {
    const bundle = await bundlePreload();
    js = bundle.js;
    metafile = bundle.result.metafile;

    exposeInMainWorld = jest.fn();
    invoke = jest.fn(() => Promise.resolve({ success: true, data: [] }));
    const fakeElectron = {
      contextBridge: { exposeInMainWorld },
      ipcRenderer: { invoke, on: jest.fn(), removeListener: jest.fn() },
    };
    required = [];
    const sandboxRequire = (id: string): unknown => {
      required.push(id);
      if (id === 'electron') return fakeElectron;
      throw new Error(`Cannot find module '${id}'`);
    };
    const module = { exports: {} };

    // A fresh realm: only JavaScript built-ins plus the CommonJS wrapper's three names
    vm.runInNewContext(
      js.text,
      { require: sandboxRequire, module, exports: module.exports },
      { filename: 'dist/preload/index.js' }
    );
  });

  it('calls contextBridge.exposeInMainWorld("api", …) exactly once and requires only electron', () => {
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(exposeInMainWorld.mock.calls[0][0]).toBe('api');
    expect(required).toEqual(['electron']);
    expect(findForbiddenImports(metafile)).toEqual([]);
  });

  it('exposes every WindowApi contract method, plus events.on', () => {
    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, Record<string, unknown>>;
    const missing: string[] = [];
    for (const [namespace, methods] of Object.entries(contract)) {
      for (const method of Object.keys(methods)) {
        if (typeof api[namespace]?.[method] !== 'function') missing.push(`${namespace}.${method}`);
      }
    }
    expect(missing).toEqual([]);
    expect(Object.keys(api).sort()).toEqual([...Object.keys(contract), 'events'].sort());
    expect(typeof api.events.on).toBe('function');
  });

  it('api.watches.list() invokes the watches:list channel', async () => {
    const api = exposeInMainWorld.mock.calls[0][1] as {
      watches: { list(): Promise<unknown> };
    };
    invoke.mockClear();

    await expect(api.watches.list()).resolves.toEqual({ success: true, data: [] });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('watches:list', undefined);
  });

  it('carries channel names only: no zod, and stays small', () => {
    expect(js.text).not.toContain('ZodError');
    expect(js.text).toContain('"watches:list"');
    expect(js.contents.length).toBeLessThan(50 * 1024);
  });
});
