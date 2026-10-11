/**
 * The catalogue service's pure helpers: the FTS5 query builder, deadlines on provider calls,
 * error codes for per-provider failures, stay cache keys and derived summaries.
 */

import {
  catalogErrorCode,
  DERIVED_SUMMARY_LENGTH,
  stayCacheKey,
  summaryFromHtml,
  withDeadline,
} from '@main/core/catalog/catalog-helpers';
import { searchWords, toFtsQuery } from '@main/database/repositories/location.repository';
import {
  AccessGateError,
  ProviderError,
  ProviderHttpError,
  ProviderParseError,
  ProviderTimeoutError,
} from '@main/providers/sdk/errors';

describe('toFtsQuery', () => {
  it('makes each word a quoted prefix, all of them required', () => {
    expect(toFtsQuery('kurrajong cape')).toBe('"kurrajong"* AND "cape"*');
    expect(toFtsQuery('  bay ')).toBe('"bay"*');
  });

  it('strips FTS syntax characters, which separate words like any punctuation', () => {
    expect(toFtsQuery('"bay*" ^(cape): -lucky +camp')).toBe(
      '"bay"* AND "cape"* AND "lucky"* AND "camp"*'
    );
    expect(toFtsQuery('T-Bone')).toBe('"T"* AND "Bone"*');
  });

  it('drops the FTS operators AND, OR, NOT and NEAR, in any case', () => {
    expect(toFtsQuery('bay OR cape NOT and near NEAR(x y)')).toBe(
      '"bay"* AND "cape"* AND "x"* AND "y"*'
    );
  });

  it('treats text with no words (empty, whitespace or punctuation only) as no text', () => {
    for (const text of [undefined, '', '   ', '\t\n', '"*^():-+', '; -- */', 'AND OR']) {
      expect([text, toFtsQuery(text)]).toEqual([text, undefined]);
    }
  });

  it('turns an injection attempt into plain words', () => {
    expect(toFtsQuery('"; DROP TABLE')).toBe('"DROP"* AND "TABLE"*');
    expect(toFtsQuery(`x" OR rowid > 0 --`)).toBe('"x"* AND "rowid"* AND "0"*');
  });

  it('keeps non-ASCII letters and combining marks inside words', () => {
    expect(searchWords('Dirk Hartog')).toEqual(['Dirk', 'Hartog']);
    expect(searchWords('Pīnaroo Café')).toEqual(['Pīnaroo', 'Café']);
    // e + combining acute accent stays one word
    expect(searchWords('Café bay')).toEqual(['Café', 'bay']);
  });
});

describe('catalogErrorCode', () => {
  it('an access gate (queue) failure is access-gate', () => {
    expect(catalogErrorCode(new AccessGateError('fake', 'waiting'))).toBe('access-gate');
  });

  it('a timeout is timeout', () => {
    expect(
      catalogErrorCode(
        new ProviderTimeoutError({ providerId: 'p', url: 'https://x', timeoutMs: 1 })
      )
    ).toBe('timeout');
    expect(
      catalogErrorCode(new ProviderError({ providerId: 'p', code: 'timeout', message: 't' }))
    ).toBe('timeout');
  });

  it('an HTTP failure is http and an unreadable answer is parse', () => {
    expect(
      catalogErrorCode(new ProviderHttpError({ providerId: 'p', status: 503, url: 'https://x' }))
    ).toBe('http');
    expect(catalogErrorCode(new ProviderParseError({ providerId: 'p', message: 'bad' }))).toBe(
      'parse'
    );
  });

  it('anything else is unknown', () => {
    expect(catalogErrorCode(new ProviderError({ providerId: 'p', message: 'odd' }))).toBe(
      'unknown'
    );
    expect(catalogErrorCode(new TypeError('boom'))).toBe('unknown');
    expect(catalogErrorCode('a string')).toBe('unknown');
  });
});

describe('withDeadline', () => {
  const never = (): Promise<never> => new Promise(() => undefined);

  it('resolves with the task when it answers in time', async () => {
    const parent = new AbortController();
    await expect(withDeadline('p', 1_000, parent.signal, async () => 42)).resolves.toBe(42);
  });

  it('rejects with a timeout error and aborts the task signal at the deadline, even if the task ignores it', async () => {
    const parent = new AbortController();
    let seen: AbortSignal | undefined;
    const pending = withDeadline('fake', 20, parent.signal, (signal) => {
      seen = signal;
      return never();
    });
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ providerId: 'fake', code: 'timeout', retryable: true });
    expect(catalogErrorCode(error)).toBe('timeout');
    expect(seen?.aborted).toBe(true);
  });

  it('rejects with an AbortError when the parent aborts (the service stops)', async () => {
    const parent = new AbortController();
    const pending = withDeadline('fake', 10_000, parent.signal, () => never());
    parent.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(withDeadline('fake', 10_000, parent.signal, async () => 1)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('passes the task error through, and a synchronous throw becomes a rejection', async () => {
    const parent = new AbortController();
    const failure = new ProviderParseError({ providerId: 'p', message: 'bad' });
    await expect(
      withDeadline('p', 1_000, parent.signal, () => Promise.reject(failure))
    ).rejects.toBe(failure);
    await expect(
      withDeadline('p', 1_000, parent.signal, () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });
});

describe('stayCacheKey', () => {
  const stay = { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 };

  it('is the same for stays that ask the same question', () => {
    expect(stayCacheKey(stay)).toBe(stayCacheKey({ ...stay, children: 0, infants: 0 }));
    expect(stayCacheKey({ ...stay, params: { a: 1, b: 'x' } })).toBe(
      stayCacheKey({ ...stay, params: { b: 'x', a: 1 } })
    );
  });

  it('differs when any part of the stay differs', () => {
    const base = stayCacheKey(stay);
    for (const changed of [
      { ...stay, arrival: '2026-11-11' },
      { ...stay, departure: '2026-11-13' },
      { ...stay, adults: 3 },
      { ...stay, children: 1 },
      { ...stay, equipment: 'tent' },
      { ...stay, params: { gearType: 'tent' } },
    ]) {
      expect(stayCacheKey(changed)).not.toBe(base);
    }
  });
});

describe('summaryFromHtml', () => {
  it("is the description's text with tags, styles and scripts gone and whitespace collapsed", () => {
    const html = `<style>.red { color: red }</style>
      <h4 style="color:red"><strong>In the Gascoyne</strong></h4><p>Five&nbsp;camp sites</p>
      <script>alert(1)</script><ul><li>Toilets</li><li>Tents &amp; vans</li></ul>`;
    expect(summaryFromHtml(html)).toBe('In the Gascoyne Five camp sites Toilets Tents & vans');
  });

  it(`keeps the first ${DERIVED_SUMMARY_LENGTH} characters`, () => {
    const summary = summaryFromHtml(`<p>${'word '.repeat(100)}</p>`)!;
    expect(summary.length).toBeLessThanOrEqual(DERIVED_SUMMARY_LENGTH);
    expect(summary.length).toBeGreaterThan(DERIVED_SUMMARY_LENGTH - 5);
    expect(summary.startsWith('word word')).toBe(true);
    expect(summary).toBe(summary.trim());
  });

  it('is undefined for a description without text', () => {
    expect(summaryFromHtml(undefined)).toBeUndefined();
    expect(summaryFromHtml('')).toBeUndefined();
    expect(summaryFromHtml('<style>p{}</style><img src="https://x/y.jpg"><hr>')).toBeUndefined();
  });

  it('decodes numeric entities and leaves unknown ones as written', () => {
    expect(summaryFromHtml('<p>Caf&#233; &#x2014; &bogus; bay</p>')).toBe('Café — &bogus; bay');
  });
});
