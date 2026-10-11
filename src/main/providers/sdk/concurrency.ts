/**
 * Concurrency caps, so a provider never sends more parallel requests than it should.
 */

export interface Limiter {
  /** Runs `task` once fewer than `n` tasks are running; queued tasks start in call order. */
  <T>(task: () => Promise<T>): Promise<T>;
  readonly activeCount: number;
  readonly pendingCount: number;
}

export function createLimiter(n: number): Limiter {
  if (!Number.isInteger(n) || n < 1)
    throw new RangeError(`Concurrency must be at least 1, got ${n}`);
  let active = 0;
  const queue: Array<() => void> = [];

  const next = (): void => {
    if (active >= n) return;
    const start = queue.shift();
    if (start) start();
  };

  const limit = <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active++;
        let result: Promise<T>;
        try {
          result = Promise.resolve(task());
        } catch (error) {
          result = Promise.reject(error);
        }
        result.then(resolve, reject).finally(() => {
          active--;
          next();
        });
      });
      next();
    });

  return Object.defineProperties(limit, {
    activeCount: { get: () => active },
    pendingCount: { get: () => queue.length },
  }) as Limiter;
}

/**
 * Maps `items` through `fn` with at most `n` calls in flight. Results keep the input order.
 * The first rejection rejects the whole call and no further items are started.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  n: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(n) || n < 1)
    throw new RangeError(`Concurrency must be at least 1, got ${n}`);
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let failed = false;

  const worker = async (): Promise<void> => {
    while (!failed && nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
}
