/**
 * @jest-environment node
 *
 * `node scripts/serve-provider-site.mjs <id>` serves a browser provider's made-up site
 * (`tests/fixtures/providers/<id>/site.ts`) on loopback, for its preview in the app. Here it
 * serves the guide's example browser site, and refuses what it cannot serve.
 */

import { spawn, spawnSync, type ChildProcess } from 'child_process';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/serve-provider-site.mjs');

function run(...args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
}

/** Starts the script and resolves with its address once it says it is serving. */
function start(
  ...args: string[]
): Promise<{ child: ChildProcess; baseUrl: string; out: () => string }> {
  const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: ROOT });
  let out = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no address after 20 s:\n${out}`)), 20_000);
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
      const found = /at (http:\/\/127\.0\.0\.1:\d+)\n/.exec(out);
      if (found) {
        clearTimeout(timer);
        resolve({ child, baseUrl: found[1], out: () => out });
      }
    });
    child.stderr.on('data', (chunk) => (out += String(chunk)));
    child.once('exit', () => reject(new Error(`exited before serving:\n${out}`)));
  });
}

describe('scripts/serve-provider-site.mjs', () => {
  it("serves the example browser site's pages on loopback, logs each request, and stops on SIGTERM", async () => {
    const { child, baseUrl, out } = await start('example-browser', '--port', '0');
    try {
      expect(out()).toContain(
        'Serving tests/fixtures/providers/example-browser/site.ts (renderExampleSite)'
      );
      const parks = await fetch(`${baseUrl}/parks`);
      expect(parks.status).toBe(200);
      await expect(parks.text()).resolves.toContain('data-park="sunset-bay"');
      expect((await fetch(`${baseUrl}/parks/sunset-bay`)).status).toBe(200);
      expect((await fetch(`${baseUrl}/nowhere`)).status).toBe(404);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(out()).toMatch(/GET \/parks 200\nGET \/parks\/sunset-bay 200\nGET \/nowhere 404/);
    } finally {
      const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
      child.kill('SIGTERM');
      // The script closes its server and exits 0 on SIGTERM. Windows has no signals: kill() ends
      // the process outright (exit code null), and the script's handler never runs there.
      await expect(exited).resolves.toBe(process.platform === 'win32' ? null : 0);
    }
  }, 30_000);

  it('refuses a provider with no made-up site, pointing an API provider to the preview spec', () => {
    const result = run('example-api');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('tests/fixtures/providers/example-api/site.ts does not exist');
    expect(result.stderr).toContain('PREVIEW_PROVIDER=example-api');
  });

  it('refuses a bad id, a bad port and an export the site does not have', () => {
    expect(run('Not An Id').stderr).toContain('"Not An Id" is not a provider id');
    expect(run('example-browser', '--port', 'x').stderr).toContain('--port must be a port number');
    const missing = run('example-browser', '--export', 'nothing');
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain(
      'has no export "nothing" to serve (it has: renderExampleSite)'
    );
  });

  it('prints its usage for --help', () => {
    expect(run('--help').stdout).toContain('Usage: node scripts/serve-provider-site.mjs <id>');
  });
});
