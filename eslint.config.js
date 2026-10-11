// @ts-check
/**
 * ESLint flat config (ESLint 10). `npm run lint` (`eslint .`) checks `src`, `tests`, `scripts` and
 * the root configs.
 *
 * TypeScript and React code gets the recommended rules of ESLint, typescript-eslint, React and
 * React Hooks; the Node scripts (CommonJS, and ES modules as `.mjs`) get ESLint's. Prettier owns formatting
 * (eslint-config-prettier, last). The main process and the preload log through Winston only.
 *
 * eslint-plugin-react 7.37.5, its latest release, declares ESLint 9 at most as its peer;
 * `overrides` in package.json installs it with ESLint 10, where its rules run (see `settings`).
 */
const js = require('@eslint/js');
const { defineConfig, globalIgnores } = require('eslint/config');
const prettier = require('eslint-config-prettier/flat');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const globals = require('globals');
const tseslint = require('typescript-eslint');

module.exports = defineConfig([
  globalIgnores([
    'dist/',
    'release/',
    'out/',
    'coverage/',
    'playwright-report/',
    'test-results/',
    'resources/',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      react.configs.flat.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // The installed React, as `'detect'` would find it: eslint-plugin-react's detection calls
    // `context.getFilename()`, which ESLint 10 removed.
    settings: { react: { version: require('react/package.json').version } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // React Compiler rules (react-hooks 7) that flag deliberate patterns. The app is not
      // compiled by the React Compiler, and changing these patterns would change behaviour.
      // Latest-value refs, lazy ref init and focus captured before children's effects:
      'react-hooks/refs': 'off',
      // State set from effects on purpose: timers, DOM measurement, image and map events.
      'react-hooks/set-state-in-effect': 'off',
      // Only says whether the compiler could keep a hand-written useMemo/useCallback.
      'react-hooks/preserve-manual-memoization': 'off',
      // Only says the compiler would skip a component (react-hook-form's `watch`).
      'react-hooks/incompatible-library': 'off',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      // Test probes copy a hook's latest value into a variable the test reads.
      'react-hooks/globals': 'off',
      // `jest.isolateModules` loads a module afresh with require().
      '@typescript-eslint/no-require-imports': 'off',
      // `const { dropped: _dropped, ...kept } = row` is how a test leaves a field out.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Playwright: a fixture with no dependencies takes `{}`, and its `use` is not React's.
    files: ['tests/e2e/**/*.ts', 'tests/docs/**/*.ts'],
    rules: {
      'no-empty-pattern': 'off',
      'react-hooks/rules-of-hooks': 'off',
    },
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Node scripts written as ES modules (`scripts/new-provider.mjs`).
    files: ['**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  prettier,
]);
