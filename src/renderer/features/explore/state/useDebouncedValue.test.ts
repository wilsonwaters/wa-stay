import { act, renderHook } from '@testing-library/react';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('gives the first value at once', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 400));
    expect(result.current).toBe('a');
  });

  it('gives a new value once it has stayed the same for the delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 400), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'b' });
    act(() => jest.advanceTimersByTime(399));
    expect(result.current).toBe('a');
    act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBe('b');
  });

  it('gives only the last of a quick run of changes', () => {
    const seen: number[] = [];
    const { rerender } = renderHook(
      ({ value }) => {
        const settled = useDebouncedValue(value, 400);
        if (seen[seen.length - 1] !== settled) seen.push(settled);
        return settled;
      },
      { initialProps: { value: 1 } }
    );
    for (const value of [2, 3, 4]) {
      rerender({ value });
      act(() => jest.advanceTimersByTime(150));
    }
    act(() => jest.advanceTimersByTime(400));
    expect(seen).toEqual([1, 4]);
  });

  it('keeps the settled value when the value comes back to it before the delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 400), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'b' });
    act(() => jest.advanceTimersByTime(200));
    rerender({ value: 'a' });
    act(() => jest.advanceTimersByTime(400));
    expect(result.current).toBe('a');
  });
});
