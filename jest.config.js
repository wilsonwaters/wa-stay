/**
 * Jest configuration: two projects built from one shared base.
 *
 * - main:     Electron main process, shared code and Node scripts (testEnvironment: node)
 * - renderer: React renderer (testEnvironment: jsdom), including tests/integration/renderer
 *
 * Jest projects do not inherit root options, so everything both projects need
 * (roots, transform, module aliases) lives in `base` and is spread into each.
 * Coverage options stay at the root: coverage is aggregated across both projects and
 * the threshold is evaluated once, globally.
 */

const TEST_FILE = '*.test.[jt]s?(x)';

/**
 * Dependencies that ship only ES modules:
 * - sanitize-html's parser, htmlparser2, with its dom* packages and entities (main process);
 * - React Router 8 and its own dependencies, route-pattern and cookie-es (renderer).
 * The app loads them natively (Electron 44's Node 24 with `require(esm)`, and Vite). Jest 30
 * loads ES modules from `require` only under `--experimental-vm-modules`, so esbuild compiles
 * them to CommonJS for the tests instead (tests/utils/esm-to-cjs-transform.js).
 */
const ESM_ONLY_DEPENDENCIES = [
  'htmlparser2',
  'domhandler',
  'domutils',
  'dom-serializer',
  'domelementtype',
  'entities',
  'react-router',
  '@remix-run/route-pattern',
  'cookie-es',
];
/** A path separator: Jest matches these patterns against native paths (`\\` on Windows). */
const SEP = '[/\\\\]';
const ESM_ONLY_NAMES = `(?:${ESM_ONLY_DEPENDENCIES.map((name) => name.split('/').join(SEP)).join('|')})${SEP}`;
const ESM_ONLY = `node_modules${SEP}${ESM_ONLY_NAMES}`;

/**
 * Each test environment's own export conditions plus `development`: React Router 8, the only
 * dependency that declares it, then loads its development build (with its warnings), as
 * `npm run dev` does.
 */
const DEVELOPMENT = 'development';

const base = {
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  transform: {
    // Vite `?raw` imports (brushstroke SVGs, tokens.css) load as their real file contents.
    // Plain `.svg` and stylesheet imports never reach this: moduleNameMapper stubs them.
    '\\.(svg|css)$': '<rootDir>/tests/utils/raw-file-transform.js',
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          isolatedModules: true,
        },
      },
    ],
    [`${ESM_ONLY}.+\\.m?js$`]: '<rootDir>/tests/utils/esm-to-cjs-transform.js',
  },
  transformIgnorePatterns: [`${SEP}node_modules${SEP}(?!${ESM_ONLY_NAMES})`],
  moduleNameMapper: {
    '^@main/(.*)$': '<rootDir>/src/main/$1',
    '^@renderer/(.*)$': '<rootDir>/src/renderer/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@preload/(.*)$': '<rootDir>/src/preload/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
    // `?raw` must map first so raw imports get the real file (via raw-file-transform.js).
    '^(.+\\.(svg|css))\\?raw$': '$1',
    // A plain asset import is a URL in Vite, so it gets a URL-shaped string. A mapped module is
    // one file shared by every import, so the generic stub cannot name the asset. Assets a test
    // must tell apart (the brand logos) have a named stub, tests/utils/asset-urls/<file>.js.
    '^(?:.*/)?([^/]+\\.(?:svg|png))$': [
      '<rootDir>/tests/utils/asset-urls/$1.js',
      '<rootDir>/tests/utils/file-url-stub.js',
    ],
    // Bundled fonts (`import '@fontsource-variable/figtree'`) are stylesheets too.
    '^@fontsource-variable/': '<rootDir>/tests/utils/style-mock.js',
    '\\.(css|less|scss|sass)$': '<rootDir>/tests/utils/style-mock.js',
  },
};

module.exports = {
  projects: [
    {
      ...base,
      displayName: 'main',
      testEnvironment: 'node',
      testEnvironmentOptions: { customExportConditions: ['node', 'node-addons', DEVELOPMENT] },
      testMatch: [
        `<rootDir>/tests/unit/**/${TEST_FILE}`,
        `<rootDir>/tests/integration/**/${TEST_FILE}`,
        `<rootDir>/tests/scripts/**/${TEST_FILE}`,
        `<rootDir>/src/main/**/${TEST_FILE}`,
        `<rootDir>/src/shared/**/${TEST_FILE}`,
      ],
      // Renderer integration tests need jsdom: the renderer project runs them.
      testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/integration/renderer/'],
      setupFiles: ['<rootDir>/tests/setup/main.ts'],
    },
    {
      ...base,
      displayName: 'renderer',
      testEnvironment: 'jsdom',
      testEnvironmentOptions: { customExportConditions: ['browser', DEVELOPMENT] },
      testMatch: [
        `<rootDir>/src/renderer/**/${TEST_FILE}`,
        `<rootDir>/tests/renderer/**/${TEST_FILE}`,
        `<rootDir>/tests/integration/renderer/**/${TEST_FILE}`,
      ],
      setupFilesAfterEnv: ['<rootDir>/tests/setup/renderer.ts'],
    },
  ],
  collectCoverageFrom: [
    'src/main/**/*.{ts,tsx}',
    'src/renderer/**/*.{ts,tsx}',
    'src/shared/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.spec.{ts,tsx}',
    '!src/**/*.types.ts',
    // Type-level checks, run by `npm run type-check`, never executed.
    '!src/**/*.type-test.tsx',
    '!src/main/index.ts',
    '!src/renderer/main.tsx',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // A ratchet a few points below the measured coverage (2.0: branches 87, functions 93, lines 96,
  // statements 94), so a change that drops tests fails here. Raise it as coverage grows; never
  // lower it to pass.
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 90,
      lines: 93,
      statements: 92,
    },
  },
  testTimeout: 30000,
  // A worker that has grown past this is replaced after its current test file. Long-lived
  // workers crashed (SIGSEGV) on the macOS runner after the move to Jest 30 and jsdom 26.
  workerIdleMemoryLimit: '1GB',
};
