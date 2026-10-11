import { readScrollMemory, SCROLL_KEY_PREFIX, writeScrollMemory } from './scrollMemory';

describe('Explore scroll memory', () => {
  it('keeps the position and card count per search, in sessionStorage', () => {
    writeScrollMemory('?q=bay', { y: 1200, shown: 80 });
    expect(window.sessionStorage.getItem(`${SCROLL_KEY_PREFIX}?q=bay`)).toBe(
      JSON.stringify({ y: 1200, shown: 80 })
    );
    expect(readScrollMemory('?q=bay')).toEqual({ y: 1200, shown: 80 });
    expect(readScrollMemory('?q=cape')).toBeNull();
  });

  it('ignores anything that is not a position', () => {
    window.sessionStorage.setItem(`${SCROLL_KEY_PREFIX}a`, 'not json');
    window.sessionStorage.setItem(`${SCROLL_KEY_PREFIX}b`, JSON.stringify({ y: -1, shown: 40 }));
    window.sessionStorage.setItem(`${SCROLL_KEY_PREFIX}c`, JSON.stringify({ y: 10, shown: 1.5 }));
    expect(readScrollMemory('a')).toBeNull();
    expect(readScrollMemory('b')).toBeNull();
    expect(readScrollMemory('c')).toBeNull();
  });

  it('carries on without storage', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => writeScrollMemory('', { y: 1, shown: 40 })).not.toThrow();
    expect(readScrollMemory('')).toBeNull();
    setItem.mockRestore();
    getItem.mockRestore();
  });
});
