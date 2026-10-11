import path from 'path';

/** The project root: Electron is launched on it, so it reads `package.json` (`main`). */
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Recorded provider responses, one folder per provider (`fixtures/http/README.md`). */
export const HTTP_FIXTURES_DIR = 'tests/e2e/fixtures/http';
