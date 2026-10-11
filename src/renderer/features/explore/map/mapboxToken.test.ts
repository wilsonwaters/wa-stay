import { getMapboxToken, resolveMapboxToken, SECRET_TOKEN_MESSAGE } from './mapboxToken';

const globals = globalThis as { __MAPBOX_ACCESS_TOKEN__?: unknown };

describe('getMapboxToken (run time)', () => {
  afterEach(() => {
    delete globals.__MAPBOX_ACCESS_TOKEN__;
  });

  it('is null when the build defines no token (as under Jest)', () => {
    expect(getMapboxToken()).toBeNull();
  });

  it('accepts a public pk. token', () => {
    globals.__MAPBOX_ACCESS_TOKEN__ = 'pk.eyJ1IjoidGVzdCJ9.abc';
    expect(getMapboxToken()).toBe('pk.eyJ1IjoidGVzdCJ9.abc');
  });

  it('rejects a secret, empty or malformed token', () => {
    for (const value of ['sk.eyJ1Ijoic2VjcmV0In0.x', '', 'tk.temporary', 42]) {
      globals.__MAPBOX_ACCESS_TOKEN__ = value;
      expect(getMapboxToken()).toBeNull();
    }
  });
});

describe('resolveMapboxToken (build time)', () => {
  it('prefers the process environment, then .env, then nothing', () => {
    expect(resolveMapboxToken('pk.ci', 'pk.file')).toBe('pk.ci');
    expect(resolveMapboxToken(undefined, 'pk.file')).toBe('pk.file');
    expect(resolveMapboxToken(undefined, undefined)).toBe('');
  });

  it('lets an empty environment value win over .env (build:e2e has no token)', () => {
    expect(resolveMapboxToken('', 'pk.file')).toBe('');
  });

  it('fails the build on a secret sk. token, from either source', () => {
    expect(() => resolveMapboxToken('sk.x', undefined)).toThrow(SECRET_TOKEN_MESSAGE);
    expect(() => resolveMapboxToken(undefined, ' sk.y ')).toThrow(/secret \(sk\.\) token/);
  });
});
