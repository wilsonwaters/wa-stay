/**
 * @jest-environment node
 *
 * The Mapbox token's way into the build (E1): `.env.example` documents it empty, Vite reads it
 * only through `resolveMapboxToken` into one `define` (never `envPrefix`), and CI passes the
 * repository secret (or variable) to the build steps. `resolveMapboxToken` itself, and the
 * failure on a secret `sk.` token, are tested in src/renderer/features/explore/map.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** The lines of the workflow step named `name`, up to the next step. */
function step(workflow: string, job: string, name: string): string {
  const jobAt = workflow.indexOf(`\n  ${job}:`);
  expect(jobAt).toBeGreaterThan(-1);
  const at = workflow.indexOf(`- name: ${name}`, jobAt);
  expect(at).toBeGreaterThan(-1);
  const next = workflow.indexOf('- name:', at + 1);
  return workflow.slice(at, next < 0 ? undefined : next);
}

describe('Mapbox token wiring', () => {
  it('.env.example lists MAPBOX_ACCESS_TOKEN with no value', () => {
    expect(read('.env.example')).toMatch(/^MAPBOX_ACCESS_TOKEN=$/m);
  });

  it('.env stays out of git', () => {
    expect(read('.gitignore')).toMatch(/^\.env$/m);
  });

  it('vite.config.ts loads the repo-root .env and exposes the token only through define', () => {
    const config = read('vite.config.ts');
    expect(config).toContain("loadEnv(mode, __dirname, '')");
    expect(config).toContain(
      'resolveMapboxToken(process.env.MAPBOX_ACCESS_TOKEN, env.MAPBOX_ACCESS_TOKEN)'
    );
    expect(config).toContain('__MAPBOX_ACCESS_TOKEN__: JSON.stringify(mapboxToken)');
    // A comment may mention it; no option sets it.
    expect(config).not.toMatch(/^\s*envPrefix\s*:/m);
  });

  it('CI passes the secret (or variable) to the build steps', () => {
    const secret =
      'MAPBOX_ACCESS_TOKEN: ${{ secrets.MAPBOX_ACCESS_TOKEN || vars.MAPBOX_ACCESS_TOKEN }}';
    expect(
      step(read('.github/workflows/build.yml'), 'build-windows', 'Build application')
    ).toContain(secret);
    expect(step(read('.github/workflows/ci.yml'), 'build-check', 'Build application')).toContain(
      secret
    );
  });
});
