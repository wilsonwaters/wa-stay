/**
 * Jest transform for the dependencies that ship only ES modules (`ESM_ONLY_DEPENDENCIES` in
 * jest.config.js): esbuild rewrites each file to CommonJS, which Jest's module system loads
 * without `--experimental-vm-modules`.
 *
 * esbuild rather than ts-jest: React Router 8 reads `import.meta.hot` (only when it loads a
 * framework-mode route module, which the app never does). TypeScript leaves `import.meta` in
 * CommonJS output, where it is a syntax error; esbuild replaces it with an empty object.
 */
const crypto = require('crypto');
const fs = require('fs');
const esbuild = require('esbuild');

const OWN_SOURCE = fs.readFileSync(__filename, 'utf8');

module.exports = {
  process(sourceText, sourcePath) {
    const { code } = esbuild.transformSync(sourceText, {
      loader: 'js',
      format: 'cjs',
      target: 'node24',
      sourcefile: sourcePath,
      // `import()` becomes `require()`, as ts-jest compiles the app's own modules.
      supported: { 'dynamic-import': false },
      // "import.meta is not available with the cjs output format": expected, see above.
      logOverride: { 'empty-import-meta': 'silent' },
    });
    return { code };
  },

  getCacheKey(sourceText, sourcePath) {
    return crypto
      .createHash('sha256')
      .update(OWN_SOURCE)
      .update(esbuild.version)
      .update(sourcePath)
      .update(sourceText)
      .digest('hex');
  },
};
