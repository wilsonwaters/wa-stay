/**
 * @jest-environment node
 *
 * API boundary guard (architecture-notes §8): renderer code reaches the main process only
 * through `src/renderer/api/**`. Anywhere else, `window.api` is allowed only in the legacy
 * files listed below, which the U tasks delete as they rebuild each page. The list never grows.
 * Comments are ignored; tests (`*.test.ts(x)`) may stub `window.api` freely.
 */
import fs from 'fs';
import path from 'path';
import { stripComments } from '../../utils/strip-comments';

const RENDERER = path.resolve(__dirname, '../../../src/renderer');
const API_DIR = 'api';
const SOURCE = /\.(ts|tsx)$/;
const TEST_FILE = /\.test\.(ts|tsx)$/;

/** Pre-redesign code that still calls `window.api` itself, and the task that replaces it. */
const LEGACY_ALLOW_LIST: string[] = [];
/** The length LEGACY_ALLOW_LIST had when D3 wrote it. Lower it as entries go; never raise it. */
const LEGACY_ALLOW_LIST_MAX = 0;

/** The globals the preload API hangs off. */
const GLOBAL = String.raw`\b(?:window|globalThis|self)\b`;
/**
 * A global, bare or inside a cast: `window`, `window!`, `(window as any)`,
 * `(window as unknown as { api: Api })`, `(<any>window)`.
 */
const TARGET = String.raw`(?:${GLOBAL}|\(\s*(?:<[^<>]*>\s*)?${GLOBAL}\s*!?\s*(?:\b(?:as|satisfies)\b(?:[^()]|\([^()]*\))*)?\))\s*!?`;

/**
 * Ways to reach the preload API: `window.api`, `window?.api`, `window['api']`, `window["api"]`,
 * `const { api } = window`, the same through a cast such as `(window as any).api`, and all of
 * them through `globalThis` or `self`.
 */
const API_ACCESS = new RegExp(
  [
    String.raw`${TARGET}\s*(?:\?\.|\.)\s*api\b`,
    String.raw`${TARGET}\s*(?:\?\.)?\s*\[\s*(['"\`])api\1\s*\]`,
    String.raw`\{[^{}]*\bapi\b[^{}]*\}\s*=\s*${TARGET}`,
  ].join('|'),
  'g'
);

/** The 1-based lines of `source` that reach the preload API, comments ignored. */
function apiAccessLines(source: string): number[] {
  const code = stripComments(source);
  const lines = new Set<number>();
  for (const match of code.matchAll(API_ACCESS)) {
    lines.add(code.slice(0, match.index ?? 0).split(/\r?\n/).length);
  }
  return [...lines].sort((a, b) => a - b);
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return SOURCE.test(entry.name) && !TEST_FILE.test(entry.name) ? [full] : [];
  });
}

const relative = (file: string) => path.relative(RENDERER, file).split(path.sep).join('/');

describe('API boundary guard self-test', () => {
  it.each([
    ['a call', 'await window.api.watches.list();'],
    ['optional chaining', 'const ok = window?.api != null;'],
    ['bracket access', "const api = window['api'];"],
    ['double-quoted bracket access', 'const api = window["api"];'],
    ['template bracket access', 'const api = window[`api`];'],
    ['a cast', 'await (window as any).api.watches.list();'],
    ['a cast with optional chaining', 'const ok = (window as any)?.api != null;'],
    ['a cast with bracket access', 'const api = (window as any)["api"];'],
    ['a typed cast', 'const api = (window as unknown as { api: () => void }).api;'],
    ['an angle-bracket cast', 'const api = (<any>window).api;'],
    ['a non-null assertion', 'const api = window!.api;'],
    ['destructuring a cast', 'const { api } = window as any;'],
    ['destructuring', 'const { api } = window;'],
    ['destructuring among others', 'const { location, api: preload } = window;'],
    ['globalThis', 'globalThis.api.events.on("x", cb);'],
    ['across lines', 'const unsubscribe = window\n  .api.events.on("x", cb);'],
  ])('flags %s', (_name, source) => {
    expect(apiAccessLines(source).length).toBeGreaterThan(0);
  });

  it.each([
    ['a comment', '// components never call window.api directly'],
    ['a block comment', '/* no `window.api` here */ const x = 1;'],
    ['a different global', 'const apiKey = window.apiKey; const x = myWindow.api;'],
    ['a cast of a different global', 'const x = (myWindow as any).api;'],
    ['a different property of a cast', 'const x = (window as any).apiKey;'],
    ['a local named api', 'const api = useApi(); api.watches.list();'],
    ['a renderer api import', "import { useProviders } from '../api';"],
  ])('ignores %s', (_name, source) => {
    expect(apiAccessLines(source)).toEqual([]);
  });

  it('reports the line of each access', () => {
    expect(apiAccessLines('const a = 1;\n// window.api\nconst b = window.api;\n')).toEqual([3]);
  });
});

describe('API boundary guard', () => {
  const files = walk(RENDERER);

  it('scans the renderer, including app, features and components', () => {
    for (const dir of ['app', 'features', 'components', API_DIR]) {
      expect(files.some((f) => relative(f).startsWith(`${dir}/`))).toBe(true);
    }
  });

  it('finds window.api only in renderer/api and the legacy allow-list', () => {
    const offenders = files
      .filter((f) => !relative(f).startsWith(`${API_DIR}/`))
      .filter((f) => !LEGACY_ALLOW_LIST.includes(relative(f)))
      .flatMap((f) =>
        apiAccessLines(fs.readFileSync(f, 'utf8')).map((line) => `${relative(f)}:${line}`)
      );
    expect(offenders).toEqual([]);
  });

  it('lists only files that exist and still need the exemption', () => {
    const stale = LEGACY_ALLOW_LIST.filter((file) => {
      const full = path.join(RENDERER, file);
      return !fs.existsSync(full) || apiAccessLines(fs.readFileSync(full, 'utf8')).length === 0;
    });
    expect(stale).toEqual([]);
  });

  it('never grows the legacy allow-list', () => {
    expect(new Set(LEGACY_ALLOW_LIST).size).toBe(LEGACY_ALLOW_LIST.length);
    expect(LEGACY_ALLOW_LIST.length).toBeLessThanOrEqual(LEGACY_ALLOW_LIST_MAX);
  });

  it('keeps the shell and the data layer itself on the right side of the boundary', () => {
    const shell = files.filter((f) => relative(f).startsWith('app/'));
    expect(shell.length).toBeGreaterThan(0);
    expect(shell.flatMap((f) => apiAccessLines(fs.readFileSync(f, 'utf8')))).toEqual([]);
    const client = fs.readFileSync(path.join(RENDERER, API_DIR, 'client.ts'), 'utf8');
    expect(apiAccessLines(client).length).toBeGreaterThan(0);
  });
});
