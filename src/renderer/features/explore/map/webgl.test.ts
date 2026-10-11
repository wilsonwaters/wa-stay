import { supportsWebGL } from './webgl';

/** A document whose canvases answer `getContext` as told. */
function fakeDocument(getContext: (type: string) => unknown): Document {
  return {
    createElement: () => ({ getContext }),
  } as unknown as Document;
}

describe('supportsWebGL', () => {
  it('is true with WebGL 2, and releases the probe context', () => {
    const loseContext = jest.fn();
    const context = { getExtension: () => ({ loseContext }) };
    expect(supportsWebGL(fakeDocument((type) => (type === 'webgl2' ? context : null)))).toBe(true);
    expect(loseContext).toHaveBeenCalled();
  });

  it('falls back to WebGL 1', () => {
    const context = { getExtension: () => null };
    expect(supportsWebGL(fakeDocument((type) => (type === 'webgl' ? context : null)))).toBe(true);
  });

  it('is false with neither, or when asking throws', () => {
    expect(supportsWebGL(fakeDocument(() => null))).toBe(false);
    expect(
      supportsWebGL(
        fakeDocument(() => {
          throw new Error('GPU process unavailable');
        })
      )
    ).toBe(false);
  });
});
