/**
 * jest.config.js compiles the dependencies that ship only ES modules to CommonJS
 * (tests/utils/esm-to-cjs-transform.js). Jest matches its patterns against native paths, so
 * they must work with `/` and with `\` (the Windows CI runner), for scoped packages and `.mjs`
 * files too; every other dependency is left as it is.
 */
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

interface Project {
  displayName: string;
  transform: Record<string, unknown>;
  transformIgnorePatterns: string[];
}

const config = require(path.join(ROOT, 'jest.config.js')) as { projects: Project[] };

/** Files of ES-module-only dependencies, as `/`-separated paths below node_modules. */
const ESM_ONLY_FILES = [
  'htmlparser2/dist/index.js',
  'entities/dist/esm/decode.js',
  'react-router/dist/development/index.js',
  'react-router/dist/development/lib/router/history.js',
  '@remix-run/route-pattern/dist/route-pattern.js',
  'cookie-es/dist/index.mjs',
];
const COMMONJS_FILES = ['react/index.js', 'better-sqlite3/lib/index.js', 'zod/index.cjs'];

const posix = (file: string) => `/home/dev/wa-stay/node_modules/${file}`;
const windows = (file: string) => `C:\\dev\\wa-stay\\node_modules\\${file.replace(/\//g, '\\')}`;

function transformerFor(project: Project, file: string): unknown {
  const key = Object.keys(project.transform).find((pattern) => new RegExp(pattern).test(file));
  return key === undefined ? undefined : project.transform[key];
}

const ignored = (project: Project, file: string) =>
  project.transformIgnorePatterns.some((pattern) => new RegExp(pattern).test(file));

describe.each(config.projects.map((project) => [project.displayName, project] as const))(
  'jest.config.js, %s project',
  (_name, project) => {
    it.each(ESM_ONLY_FILES)('compiles %s with either separator', (file) => {
      for (const native of [posix(file), windows(file)]) {
        expect(ignored(project, native)).toBe(false);
        expect(transformerFor(project, native)).toBe(
          '<rootDir>/tests/utils/esm-to-cjs-transform.js'
        );
      }
    });

    it.each(COMMONJS_FILES)('leaves %s alone with either separator', (file) => {
      for (const native of [posix(file), windows(file)]) {
        expect(ignored(project, native)).toBe(true);
      }
    });
  }
);
