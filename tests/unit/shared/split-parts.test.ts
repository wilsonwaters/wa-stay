/**
 * `fewestParts` (`src/shared/utils/split-parts.ts`): the fewest consecutive parts covering a
 * stay, each on one row `fits` allows; ties to the longest parts (Σ length²), then the earliest
 * rows, then the earliest boundaries; undefined when there is no cover. Checked against a
 * brute-force search on seeded random cases too.
 */
import { fewestParts, type CoverPart } from '@shared/utils/split-parts';

/** Rows of free nights, '#' free and '.' not: `fits` holds on a run of free nights. */
function freeRows(...rows: string[]): (row: number, from: number, to: number) => boolean {
  return (row, from, to) =>
    rows[row]
      .slice(from, to)
      .split('')
      .every((night) => night === '#');
}

/** The cover a greedy search finds: from each night, the first row that reaches furthest. */
function greedy(
  rows: number,
  nights: number,
  fits: (row: number, from: number, to: number) => boolean
): CoverPart[] | undefined {
  const parts: CoverPart[] = [];
  let from = 0;
  while (from < nights) {
    let best: CoverPart | undefined;
    for (let row = 0; row < rows; row += 1) {
      for (let to = nights; to > from; to -= 1) {
        if (fits(row, from, to)) {
          if (!best || to > best.to) best = { row, from, to };
          break;
        }
      }
    }
    if (!best) return undefined;
    parts.push(best);
    from = best.to;
  }
  return parts;
}

describe('fewestParts', () => {
  it('is undefined when a night has no row that fits it', () => {
    expect(fewestParts(2, 4, freeRows('##..', '#...'))).toBeUndefined();
    expect(fewestParts(0, 3, () => true)).toBeUndefined();
  });

  it('gives no parts for no nights', () => {
    expect(fewestParts(3, 0, () => true)).toEqual([]);
  });

  it('gives one part when one row covers every night (the first such row)', () => {
    expect(fewestParts(3, 4, freeRows('##.#', '####', '####'))).toEqual([
      { row: 1, from: 0, to: 4 },
    ]);
  });

  it('beats a greedy search when a rule bites: the longest first part can leave no good second', () => {
    // Row 1 takes stays of at least 3 nights; rows 2 and 3 a night each
    const rows = ['###..', '.####', '...#.', '....#'];
    const fits = (row: number, from: number, to: number): boolean =>
      freeRows(...rows)(row, from, to) && (row !== 1 || to - from >= 3);

    expect(greedy(4, 5, fits)).toHaveLength(3);
    expect(fewestParts(4, 5, fits)).toEqual([
      { row: 0, from: 0, to: 1 },
      { row: 1, from: 1, to: 5 },
    ]);
  });

  it('breaks a tie of parts by the longest parts (the largest sum of squared lengths)', () => {
    // Two parts either way: 1 + 4 nights (17) beats 2 + 3 (13) and 3 + 2 (13)
    expect(fewestParts(2, 5, freeRows('###..', '.####'))).toEqual([
      { row: 0, from: 0, to: 1 },
      { row: 1, from: 1, to: 5 },
    ]);
  });

  it('then by the earliest row', () => {
    expect(fewestParts(3, 4, freeRows('##..', '..##', '..##'))).toEqual([
      { row: 0, from: 0, to: 2 },
      { row: 1, from: 2, to: 4 },
    ]);
    expect(fewestParts(3, 4, freeRows('..##', '##..', '##..'))).toEqual([
      { row: 1, from: 0, to: 2 },
      { row: 0, from: 2, to: 4 },
    ]);
  });

  it('then by the earliest boundary', () => {
    // 1 + 3 nights and 3 + 1 nights tie on squares (10) and rows (0, then 1)
    expect(fewestParts(2, 4, freeRows('###.', '.###'))).toEqual([
      { row: 0, from: 0, to: 1 },
      { row: 1, from: 1, to: 4 },
    ]);
  });

  it('reuses a row when the fewest parts do (A, then B, then A)', () => {
    expect(fewestParts(2, 6, freeRows('##..##', '..##..'))).toEqual([
      { row: 0, from: 0, to: 2 },
      { row: 1, from: 2, to: 4 },
      { row: 0, from: 4, to: 6 },
    ]);
  });

  it('covers 30 nights across 300 rows, a part a night', () => {
    let calls = 0;
    const fits = (row: number, from: number, to: number): boolean => {
      calls += 1;
      return to - from === 1 && row % 30 === from;
    };
    const cover = fewestParts(300, 30, fits);

    expect(cover).toHaveLength(30);
    expect(cover?.map((part) => part.row)).toEqual(Array.from({ length: 30 }, (_, night) => night));
    expect(calls).toBeLessThanOrEqual(((30 * 31) / 2) * 300);
  });

  describe('against a brute-force search of every cover', () => {
    /** A small, seeded generator (mulberry32), so a failure can be replayed. */
    function random(seed: number): () => number {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
      };
    }

    /** Fewer parts, then the larger Σ length², then the earlier rows, then the earlier boundaries. */
    function better(a: CoverPart[], b: CoverPart[]): boolean {
      if (a.length !== b.length) return a.length < b.length;
      const squares = (cover: CoverPart[]) =>
        cover.reduce((sum, p) => sum + (p.to - p.from) ** 2, 0);
      if (squares(a) !== squares(b)) return squares(a) > squares(b);
      for (let i = 0; i < a.length; i += 1) {
        if (a[i].row !== b[i].row) return a[i].row < b[i].row;
      }
      for (let i = 0; i < a.length; i += 1) {
        if (a[i].to !== b[i].to) return a[i].to < b[i].to;
      }
      return false;
    }

    /** The best of every cover, found by trying each one. */
    function bruteForce(
      rows: number,
      nights: number,
      fits: (row: number, from: number, to: number) => boolean
    ): CoverPart[] | undefined {
      let best: CoverPart[] | undefined;
      const visit = (from: number, parts: CoverPart[]): void => {
        if (from === nights) {
          if (!best || better(parts, best)) best = parts;
          return;
        }
        for (let to = from + 1; to <= nights; to += 1) {
          for (let row = 0; row < rows; row += 1) {
            if (fits(row, from, to)) visit(to, [...parts, { row, from, to }]);
          }
        }
      };
      visit(0, []);
      return best;
    }

    it('finds the same cover in 400 seeded cases of up to 4 rows and 7 nights', () => {
      let covered = 0;
      for (let seed = 1; seed <= 400; seed += 1) {
        const next = random(seed);
        const rows = 1 + Math.floor(next() * 4);
        const nights = 1 + Math.floor(next() * 7);
        // Each row: free nights, a minimum length, and days it takes no arrivals
        const free = Array.from({ length: rows }, () =>
          Array.from({ length: nights }, () => next() < 0.7)
        );
        const minimum = Array.from({ length: rows }, () => 1 + Math.floor(next() * 3));
        const noArrival = Array.from({ length: rows }, () =>
          Array.from({ length: nights }, () => next() < 0.15)
        );
        const fits = (row: number, from: number, to: number): boolean =>
          to - from >= minimum[row] &&
          !noArrival[row][from] &&
          free[row].slice(from, to).every(Boolean);

        const expected = bruteForce(rows, nights, fits);
        expect([seed, fewestParts(rows, nights, fits)]).toEqual([seed, expected]);
        if (expected && expected.length > 1) covered += 1;
      }
      // Not vacuous: many cases have a cover of more than one part
      expect(covered).toBeGreaterThan(30);
    });
  });
});
