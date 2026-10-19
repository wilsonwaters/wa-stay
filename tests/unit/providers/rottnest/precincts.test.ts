/**
 * The Stay Rottnest seed and its guards: every room type the stakeholder's capture lists is in
 * the seed with the same precinct group, kind, sleeps and bedrooms, and none is invented; pins
 * are on the island; and nothing of RIA's but facts is kept in the module or its fixtures, and
 * only `links.ts` and `client.ts` name a Stay Rottnest host (`ai-state/research/
 * rottnest-terms.md` §9.2, §9.7).
 */

import fs from 'fs';
import path from 'path';
import {
  precinctOfGroup,
  ROTTNEST_PRECINCTS,
  roomTypeOf,
  rottnestPrecinct,
  unitKindsOf,
} from '@main/providers/rottnest/precincts';
import { readResultsPage } from '@main/providers/rottnest/results-page';

const ROOT = path.join(__dirname, '../../../..');
const MODULE = path.join(ROOT, 'src/main/providers/rottnest');
const FIXTURES = path.join(ROOT, 'tests/fixtures/providers/rottnest');
const E2E_FIXTURES = path.join(ROOT, 'tests/e2e/fixtures/http/rottnest');

/** The names the seed mends: RIA writes BPV04 "4 Bed". */
const MENDED: Record<string, string> = { BPV04: 'Bathurst Premium View - 4 Beds' };

const captured = readResultsPage(
  fs.readFileSync(path.join(FIXTURES, 'results-2027-06-28-3n-1a.html'), 'utf8')
)!;

describe('the seed', () => {
  it('has the nine precincts, each in its own group, and 68 room types', () => {
    expect(ROTTNEST_PRECINCTS.map((precinct) => precinct.slug)).toEqual([
      'thomson-bay-north',
      'thomson-bay-south',
      'kingstown',
      'campground',
      'caroline-thomson-cabins',
      'bathurst',
      'longreach-bay',
      'fays-bay',
      'geordie-bay',
    ]);
    expect(new Set(ROTTNEST_PRECINCTS.map((precinct) => precinct.group)).size).toBe(9);
    expect(ROTTNEST_PRECINCTS.flatMap((precinct) => precinct.roomTypes)).toHaveLength(68);
  });

  it('matches the capture: every room type, its group, sleeps and bedrooms', () => {
    for (const card of captured.values()) {
      const found = roomTypeOf(card.code);
      expect(found).toBeDefined();
      expect(found?.precinct.group).toBe(card.group);
      expect(found?.type.sleeps).toBe(card.sleeps);
      expect(found?.type.bedrooms).toBe(card.bedrooms);
      expect(found?.type.locationType).toBe(card.locationType);
      // RIA's names, with its slips mended (precincts.ts)
      expect(found?.type.name).toBe(MENDED[card.code] ?? card.name);
    }
    for (const precinct of ROTTNEST_PRECINCTS) {
      for (const type of precinct.roomTypes) expect(captured.has(type.code)).toBe(true);
    }
  });

  it('kinds: self-contained a cabin, the hostel bed and dorms dorms, the family room a room', () => {
    for (const precinct of ROTTNEST_PRECINCTS) {
      for (const type of precinct.roomTypes) {
        const expected =
          type.locationType === 'self-contained'
            ? 'cabin'
            : type.locationType === 'campground'
              ? 'campsite'
              : type.code === 'KYF03'
                ? 'room'
                : 'dorm';
        expect(type.kind).toBe(expected);
      }
    }
    expect(unitKindsOf(rottnestPrecinct('kingstown')!)).toEqual(['dorm', 'room', 'cabin']);
  });

  it('pins every precinct on Rottnest Island', () => {
    for (const precinct of ROTTNEST_PRECINCTS) {
      expect(precinct.lat).toBeGreaterThan(-32.03);
      expect(precinct.lat).toBeLessThan(-31.98);
      expect(precinct.lng).toBeGreaterThan(115.44);
      expect(precinct.lng).toBeLessThan(115.56);
    }
  });

  it('finds precincts by slug and group', () => {
    expect(rottnestPrecinct('geordie-bay')?.group).toBe(39);
    expect(precinctOfGroup(44)?.slug).toBe('campground');
    expect(rottnestPrecinct('nowhere')).toBeUndefined();
  });

  it('keeps one plain sentence of its own per precinct, and no address of any kind', () => {
    for (const precinct of ROTTNEST_PRECINCTS) {
      expect(precinct.summary.length).toBeLessThanOrEqual(100);
      expect(precinct.summary).toMatch(/^[^.]+\.$/);
    }
    const seed = fs.readFileSync(path.join(MODULE, 'precincts.ts'), 'utf8');
    expect(seed).not.toMatch(/https?:\/\/(?!.*openstreetmap)/);
  });
});

describe('guards', () => {
  const sources = fs.readdirSync(MODULE).filter((file) => file.endsWith('.ts'));
  const text = (file: string) => fs.readFileSync(path.join(MODULE, file), 'utf8');

  it('names a Stay Rottnest host only in links.ts (and the client reads it from there)', () => {
    for (const file of sources) {
      if (file === 'links.ts') continue;
      expect([
        file,
        /stayrottnest\.com|rottnestisland\.com|ria\.wa\.gov\.au/.test(
          text(file).replace(/\/\*\*[\s\S]*?\*\//g, '')
        ),
      ]).toEqual([file, false]);
    }
  });

  it("never names the booking step's path in code", () => {
    for (const file of sources) {
      const code = text(file)
        .replace(/\/\*\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect([file, code.includes('/details/')]).toEqual([file, false]);
    }
  });

  it('sends only through the client: no module but client.ts touches ctx.http or ctx.browser', () => {
    for (const file of sources) {
      if (file === 'client.ts' || file === 'index.ts') continue;
      expect([file, /\bctx\.(http|browser)\b/.test(text(file))]).toEqual([file, false]);
    }
  });

  it("keeps nothing of RIA's in the fixtures but facts: no image, description, script source or analytics", () => {
    for (const dir of [FIXTURES, E2E_FIXTURES]) {
      for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.html'))) {
        const html = fs.readFileSync(path.join(dir, file), 'utf8');
        expect([
          file,
          /<img|room-content-text|googletagmanager|facebook|typekit|\/details\//.test(html),
        ]).toEqual([file, false]);
        expect([file, /<script[^>]*src=/.test(html)]).toEqual([file, false]);
      }
    }
  });
});
