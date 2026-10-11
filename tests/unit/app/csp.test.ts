/**
 * The renderer CSP: the exact production policy, what development adds, and what Mapbox GL
 * JS v3 and provider photos need.
 */

import { buildCsp } from '@main/app/csp';

const PRODUCTION =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https:; font-src 'self' data:; " +
  "connect-src 'self' https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com; " +
  "worker-src 'self' blob:; child-src blob:; frame-src 'none'; object-src 'none'; " +
  "base-uri 'none'; form-action 'none'";

/** `{ directive: sources[] }` */
function parse(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split('; ').map((directive) => {
      const [name, ...sources] = directive.split(' ');
      return [name, sources];
    })
  );
}

describe('buildCsp', () => {
  it('production: exactly the pinned policy', () => {
    expect(buildCsp({ dev: false })).toBe(PRODUCTION);
  });

  it('development: adds inline scripts and the dev server http + ws origins, nothing else', () => {
    const dev = parse(buildCsp({ dev: true, devOrigin: 'http://localhost:3005' }));
    const prod = parse(PRODUCTION);

    expect(dev['script-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(dev['connect-src']).toEqual([
      ...prod['connect-src'],
      'http://localhost:3005',
      'ws://localhost:3005',
    ]);
    const others = (policy: Record<string, string[]>): Record<string, string[]> =>
      Object.fromEntries(
        Object.entries(policy).filter(([name]) => name !== 'script-src' && name !== 'connect-src')
      );
    expect(others(dev)).toEqual(others(prod));

    // A path on the dev URL is reduced to its origin; https dev servers use wss
    expect(
      parse(buildCsp({ dev: true, devOrigin: 'https://dev.local:8443/app/' }))['connect-src']
    ).toEqual(expect.arrayContaining(['https://dev.local:8443', 'wss://dev.local:8443']));
  });

  it("'unsafe-inline' scripts and 'unsafe-eval' never appear in production", () => {
    const prod = parse(buildCsp({ dev: false }));
    expect(prod['script-src']).toEqual(["'self'"]);
    expect(buildCsp({ dev: false })).not.toContain('unsafe-eval');
    expect(buildCsp({ dev: true, devOrigin: 'http://localhost:3000' })).not.toContain(
      'unsafe-eval'
    );
  });

  it('allows Mapbox GL JS v3 and https provider photos', () => {
    const prod = parse(buildCsp({ dev: false }));
    expect(prod['connect-src']).toEqual(
      expect.arrayContaining([
        'https://api.mapbox.com',
        'https://*.tiles.mapbox.com',
        'https://events.mapbox.com',
      ])
    );
    expect(prod['worker-src']).toContain('blob:');
    expect(prod['child-src']).toEqual(['blob:']);
    expect(prod['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https:']);
    expect(prod['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(prod['font-src']).toEqual(["'self'", 'data:']);
  });

  it('rejects a dev origin that is not an http(s) URL', () => {
    expect(() => buildCsp({ dev: true, devOrigin: 'localhost:3000' })).toThrow(
      'Invalid dev server origin'
    );
    expect(() => buildCsp({ dev: true, devOrigin: 'file:///index.html' })).toThrow(
      'Invalid dev server origin'
    );
  });
});
