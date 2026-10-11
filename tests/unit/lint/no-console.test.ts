/**
 * The main process and the preload log through the Winston logger only: there are no
 * `console.*` calls in `src/main` or `src/preload`, and ESLint's `no-console` rule makes a
 * new one fail `npm run lint`.
 */

import fs from 'fs';
import path from 'path';
import { ESLint } from 'eslint';

const ROOT = path.resolve(__dirname, '../../..');
const CONSOLE_CALL = /console\.(log|info|warn|error|debug)/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('no console in the main process and preload', () => {
  it('src/main and src/preload contain no console.* calls', () => {
    const offenders = ['src/main', 'src/preload']
      .flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
      .flatMap((file) =>
        fs
          .readFileSync(file, 'utf8')
          .split(/\r?\n/)
          .map((line, index) => ({ line, at: `${path.relative(ROOT, file)}:${index + 1}` }))
          .filter(({ line }) => CONSOLE_CALL.test(line))
          .map(({ at }) => at)
      );

    expect(offenders).toEqual([]);
  });

  it('ESLint fails a new console call in src/main and src/preload, not in the renderer', async () => {
    // ESLint loads eslint.config.js with import(), which Jest allows only under
    // --experimental-vm-modules, so the test passes ESLint the same config itself.
    const config = require(path.join(ROOT, 'eslint.config.js'));
    const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: true, overrideConfig: config });
    const code = "export function probe(): void {\n  console.log('probe');\n}\n";
    const ruleIds = async (file: string): Promise<Array<[string | null, number]>> => {
      const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
      return result.messages.map((message) => [message.ruleId, message.severity]);
    };

    expect(await ruleIds('src/main/services/probe.ts')).toEqual([['no-console', 2]]);
    expect(await ruleIds('src/preload/probe.ts')).toEqual([['no-console', 2]]);
    expect(await ruleIds('src/renderer/probe.ts')).toEqual([]);
  }, 60_000);
});
