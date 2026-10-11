// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- a global declaration: window.api
/// <reference path="../../src/preload/window.d.ts" />
/**
 * Mock `window.api` for renderer tests.
 *
 * `createMockWindowApi()` returns a Proxy, so it needs no list of namespaces or methods
 * and keeps working when the preload API is reshaped. Every member, at any depth, is a
 * `jest.fn()` that rejects with "window.api.<path> is not mocked in this test" until a
 * test stubs it:
 *
 *   jest.mocked(window.api.watches.list).mockResolvedValue({ success: true, data: [] });
 *   window.api.settings.get = jest.fn().mockResolvedValue({ success: true, data: null });
 *
 * Accessing the same member twice returns the same mock, so a stub set by the test is the
 * function the code under test calls. The renderer setup (tests/setup/renderer.ts)
 * installs a fresh instance on `window.api` before every test.
 */

type MockTarget = Record<PropertyKey, unknown>;

/**
 * Keys that test tooling probes on arbitrary values. Answering them with a mock would make
 * a member look like a promise (`then`), a Jasmine spy (`calls`), an asymmetric matcher, a
 * React element, a DOM node or an Immutable collection (`@@...`), so they read through to
 * the underlying object instead.
 */
const PROBED_KEYS = new Set([
  'then',
  'calls',
  'asymmetricMatch',
  'toAsymmetricMatcher',
  '$$typeof',
  'toJSON',
  'nodeType',
  '__esModule',
]);

/** jest.fn's own API (mockResolvedValue, mock, …) lives on the function or its prototype chain. */
function isMockApiKey(target: object, prop: PropertyKey): boolean {
  return typeof prop === 'string' && prop.startsWith('mock') && prop in target;
}

function isProbedKey(prop: PropertyKey): boolean {
  return typeof prop !== 'string' || PROBED_KEYS.has(prop) || prop.startsWith('@@');
}

/**
 * Proxy handler shared by the root object and every member: unknown string keys create
 * (and cache) a nested member; anything already present, including jest.fn's own API such
 * as `mockResolvedValue` and values assigned by a test, is returned as is.
 */
function memberHandler<T extends object>(path: string | null): ProxyHandler<T> {
  return {
    get(target, prop, receiver) {
      if (
        isProbedKey(prop) ||
        Object.prototype.hasOwnProperty.call(target, prop) ||
        isMockApiKey(target, prop)
      ) {
        return Reflect.get(target, prop, receiver);
      }
      const member = createMockMember(path === null ? String(prop) : `${path}.${String(prop)}`);
      Reflect.set(target, prop, member);
      return member;
    },
  };
}

function createMockMember(path: string): jest.Mock {
  const name = `window.api.${path}`;
  const fn = jest
    .fn(() => Promise.reject(new Error(`${name} is not mocked in this test`)))
    .mockName(name);
  return new Proxy(fn, memberHandler<jest.Mock>(path));
}

export function createMockWindowApi(): Window['api'] {
  return new Proxy<MockTarget>({}, memberHandler<MockTarget>(null)) as unknown as Window['api'];
}
