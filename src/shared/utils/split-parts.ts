/**
 * The fewest bookings that cover a stay when no one unit is free for all of it: the cover a
 * split stay is made of. The core derives one across units that are one place each
 * (`src/main/core/split-stays.ts`), and a provider may cover a class of sites with it from its
 * own per-site answer.
 *
 * No node or electron imports: the renderer compiles this file too.
 */

/** One part of a cover: nights `[from, to)` on row `row`. */
export interface CoverPart {
  row: number;
  /** The index of the part's first night. */
  from: number;
  /** The index of the night after its last (`from` < `to`). */
  to: number;
}

/** The best cover found so far of nights `0..i-1`, and what it is ranked by. */
interface Best {
  parts: CoverPart[];
  /** Σ length²: more for longer parts, so the fewest moves come early in a tie. */
  squares: number;
}

/**
 * Negative when `a` is the better cover, positive when `b` is, 0 when they are the same: fewer
 * parts, then the larger Σ length², then the earlier rows part by part, then the earlier
 * boundaries part by part.
 */
function compareCovers(a: Best, b: Best): number {
  if (a.parts.length !== b.parts.length) return a.parts.length - b.parts.length;
  if (a.squares !== b.squares) return b.squares - a.squares;
  for (let i = 0; i < a.parts.length; i += 1) {
    if (a.parts[i].row !== b.parts[i].row) return a.parts[i].row - b.parts[i].row;
  }
  for (let i = 0; i < a.parts.length; i += 1) {
    if (a.parts[i].to !== b.parts[i].to) return a.parts[i].to - b.parts[i].to;
  }
  return 0;
}

/**
 * The fewest consecutive parts that cover nights 0..nights-1, each part [from, to) on one row
 * for which `fits(row, from, to)` holds; undefined when no cover exists. Ties go to the longest
 * parts (the largest sum of squared lengths), then the earliest row, then the earliest boundary,
 * so the answer is stable. Pure; no node or electron imports.
 *
 * A dynamic programme over nights: the best cover of nights `0..i-1` extends the best cover of
 * `0..j-1` (each `j < i`) by the first row that fits `[j, i)`. Every criterion compares a shared
 * prefix first, so keeping only the best cover of each prefix finds the best cover overall.
 * `fits` is called at most `nights × (nights + 1) / 2 × rows` times: callers make it cheap
 * (a precomputed run length first, the full check only for candidates). No nights: no parts.
 */
export function fewestParts(
  rows: number,
  nights: number,
  fits: (row: number, from: number, to: number) => boolean
): CoverPart[] | undefined {
  if (nights <= 0) return [];
  const best: Array<Best | undefined> = [{ parts: [], squares: 0 }];
  for (let to = 1; to <= nights; to += 1) {
    let chosen: Best | undefined;
    for (let from = 0; from < to; from += 1) {
      const before = best[from];
      if (!before) continue;
      let row = 0;
      while (row < rows && !fits(row, from, to)) row += 1;
      if (row === rows) continue;
      const length = to - from;
      const candidate: Best = {
        parts: [...before.parts, { row, from, to }],
        squares: before.squares + length * length,
      };
      if (!chosen || compareCovers(candidate, chosen) < 0) chosen = candidate;
    }
    best[to] = chosen;
  }
  return best[nights]?.parts;
}
