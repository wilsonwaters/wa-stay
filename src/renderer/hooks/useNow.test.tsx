import { act, render, screen } from '@testing-library/react';
import { useHasPassed, useNow } from './useNow';

function Clock({ label }: { label: string }) {
  const now = useNow(60_000);
  return <p>{`${label} ${now.toISOString()}`}</p>;
}

describe('useNow', () => {
  afterEach(() => jest.useRealTimers());

  it('ticks every interval from one shared timer, and stops when nothing listens', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-09T07:00:00Z'));
    const setInterval = jest.spyOn(global, 'setInterval');
    const { unmount } = render(
      <>
        <Clock label="a" />
        <Clock label="b" />
      </>
    );
    expect(screen.getByText('a 2026-10-09T07:00:00.000Z')).toBeInTheDocument();
    expect(setInterval).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('a 2026-10-09T07:01:00.000Z')).toBeInTheDocument();
    expect(screen.getByText('b 2026-10-09T07:01:00.000Z')).toBeInTheDocument();

    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('runs one interval for 50 countdowns', () => {
    jest.useFakeTimers();
    const setInterval = jest.spyOn(global, 'setInterval');
    function Second({ n }: { n: number }) {
      const now = useNow(1000);
      return <span>{`${n}:${now.getTime()}`}</span>;
    }
    const { unmount } = render(
      <>
        {Array.from({ length: 50 }, (_, n) => (
          <Second key={n} n={n} />
        ))}
      </>
    );
    expect(setInterval).toHaveBeenCalledTimes(1);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stops while the window is hidden and catches up when it shows again', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-09T07:00:00Z'));
    const hidden = jest.spyOn(document, 'hidden', 'get');
    const setVisibility = (isHidden: boolean) => {
      hidden.mockReturnValue(isHidden);
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    };
    try {
      hidden.mockReturnValue(false);
      const { unmount } = render(<Clock label="c" />);
      setVisibility(true);
      expect(jest.getTimerCount()).toBe(0);

      act(() => {
        jest.advanceTimersByTime(5 * 60_000);
      });
      expect(screen.getByText('c 2026-10-09T07:00:00.000Z')).toBeInTheDocument();

      setVisibility(false);
      expect(screen.getByText('c 2026-10-09T07:05:00.000Z')).toBeInTheDocument();
      expect(jest.getTimerCount()).toBe(1);
      act(() => {
        jest.advanceTimersByTime(60_000);
      });
      expect(screen.getByText('c 2026-10-09T07:06:00.000Z')).toBeInTheDocument();
      unmount();
    } finally {
      hidden.mockRestore();
    }
  });

  it('says when an instant has passed, re-rendering only when that changes', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-09T07:00:00Z'));
    let renders = 0;
    function Expiry() {
      renders += 1;
      const passed = useHasPassed(new Date('2026-10-09T07:00:03Z'));
      return <p>{passed ? 'expired' : 'held'}</p>;
    }
    render(<Expiry />);
    expect(screen.getByText('held')).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(renders).toBe(1);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByText('expired')).toBeInTheDocument();
    expect(renders).toBe(2);
  });
});
