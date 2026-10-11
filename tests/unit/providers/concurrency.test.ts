/**
 * createLimiter and mapWithConcurrency: the cap holds, queued work starts in call order,
 * and results keep input order.
 */

import { createLimiter, mapWithConcurrency } from '@main/providers/sdk';

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('createLimiter', () => {
  it('never runs more than n tasks at once, and starts queued tasks in call order', async () => {
    const limit = createLimiter(2);
    const gates = Array.from({ length: 5 }, deferred);
    const started: number[] = [];
    let running = 0;
    let peak = 0;

    const results = gates.map((gate, i) =>
      limit(async () => {
        started.push(i);
        running++;
        peak = Math.max(peak, running);
        await gate.promise;
        running--;
        return i * 10;
      })
    );

    await flush();
    expect(started).toEqual([0, 1]);
    expect(limit.activeCount).toBe(2);
    expect(limit.pendingCount).toBe(3);

    gates[1].resolve();
    await flush();
    expect(started).toEqual([0, 1, 2]);

    gates.forEach((gate) => gate.resolve());
    expect(await Promise.all(results)).toEqual([0, 10, 20, 30, 40]);
    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(limit.activeCount).toBe(0);
  });

  it('frees the slot when a task rejects or throws synchronously', async () => {
    const limit = createLimiter(1);
    const failing = limit(() => Promise.reject(new Error('nope')));
    const throwing = limit(() => {
      throw new Error('sync');
    });
    const after = limit(async () => 'ran');

    await expect(failing).rejects.toThrow('nope');
    await expect(throwing).rejects.toThrow('sync');
    await expect(after).resolves.toBe('ran');
  });

  it('rejects a concurrency below 1', () => {
    expect(() => createLimiter(0)).toThrow(RangeError);
    expect(() => createLimiter(1.5)).toThrow(RangeError);
  });
});

describe('mapWithConcurrency', () => {
  it('keeps input order with at most n in flight', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapWithConcurrency([30, 5, 20, 1, 10], 2, async (ms, index) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, ms));
      running--;
      return `${index}:${ms}`;
    });

    expect(results).toEqual(['0:30', '1:5', '2:20', '3:1', '4:10']);
    expect(peak).toBe(2);
  });

  it('rejects on the first failure and starts nothing after it', async () => {
    const seen: number[] = [];
    await expect(
      mapWithConcurrency([1, 2, 3, 4], 1, async (n) => {
        seen.push(n);
        if (n === 2) throw new Error('two');
        return n;
      })
    ).rejects.toThrow('two');
    expect(seen).toEqual([1, 2]);
  });

  it('handles an empty list', async () => {
    await expect(mapWithConcurrency([], 3, async () => 1)).resolves.toEqual([]);
  });
});
