/**
 * RAC's free counts on a check (`src/main/providers/rac/mapping.ts`): a category is one unit
 * that stands for its sites, so `freeCount` is the whole number of sites free for the whole
 * stay (`stay_through_sites_available`) when the category is free for it, else 0: the number
 * Explore adds up (`bulk.ts`), so the place page and a watch count the same.
 */

import fs from 'fs';
import path from 'path';
import { parkEntry } from '@main/providers/rac/bulk';
import {
  categoryAvailability,
  readAvailability,
  wholeUnits,
  type RawCategory,
} from '@main/providers/rac/mapping';
import { racPark } from '@main/providers/rac/parks';
import type { UnitAvailability, UnitKind } from '@shared/types/provider.types';
import { bulkSplitViolations } from '@tests/utils/provider-contract';

const RAC_FIXTURES = path.join(__dirname, '../../../fixtures/providers/rac');
const NIGHTS = ['2026-11-06', '2026-11-07'];

/** Busselton's categories for 6–8 Nov 2026, each changed by `edit`. */
function busselton(edit: (category: Record<string, unknown>) => void = () => undefined) {
  const json = JSON.parse(
    fs.readFileSync(path.join(RAC_FIXTURES, 'availability-busselton-2026-11-06-2n.json'), 'utf8')
  ) as { data: Record<string, Record<string, unknown>> };
  Object.values(json.data).forEach(edit);
  const reading = readAvailability(JSON.stringify(json));
  if (!reading.ok) throw new Error(reading.why);
  return reading.categories;
}

const byId = (categories: RawCategory[], id: number) =>
  categories.find((category) => category.category_id === id)!;

describe('RAC free counts (freeCount)', () => {
  it("counts the powered site's 51 sites free for the whole stay, not a night's 53 or 55", () => {
    const powered = byId(busselton(), 4);
    expect(powered.sites_available).toEqual({ '2026-11-06': 53, '2026-11-07': 55 });
    const unit = categoryAvailability(powered, NIGHTS);
    expect([unit.fullyAvailable, unit.freeCount]).toEqual([true, 51]);
  });

  it('counts none at the sold-out ensuite site', () => {
    const unit = categoryAvailability(byId(busselton(), 7), NIGHTS);
    expect([unit.fullyAvailable, unit.freeCount]).toEqual([false, 0]);
  });

  it('counts none at a category free for the stay that no tariff takes (a members-only rate, without a number)', () => {
    const categories = busselton((category) => {
      if (category.category_id !== 4) return;
      const [standard] = category.tariffs_available as Array<Record<string, unknown>>;
      Object.assign(standard, { tariff_success: 'false', tariff_code: 4, tariff_total: 999 });
    });
    const everyone = categoryAvailability(byId(categories, 4), NIGHTS);
    expect([everyone.fullyAvailable, everyone.freeCount]).toEqual([false, 0]);
    const member = categoryAvailability(byId(categories, 4), NIGHTS, { member: true });
    expect([member.fullyAvailable, member.freeCount]).toEqual([true, 51]);
  });

  it('reads a count as whole sites: a fraction rounds down, and less than one site is none', () => {
    expect([wholeUnits(51), wholeUnits(2.7), wholeUnits(0.5), wholeUnits(0)]).toEqual([
      51, 2, 0, 0,
    ]);
    expect([wholeUnits(-3), wholeUnits(undefined), wholeUnits(Number.NaN)]).toEqual([0, 0, 0]);
    const counted = (sites: unknown) =>
      categoryAvailability(
        byId(
          busselton((category) => {
            if (category.category_id === 4) category.stay_through_sites_available = sites;
          }),
          4
        ),
        NIGHTS
      );
    expect([counted('12').fullyAvailable, counted('12').freeCount]).toEqual([true, 12]);
    expect([counted(2.7).fullyAvailable, counted(2.7).freeCount]).toEqual([true, 2]);
    // Less than one whole site for the stay: not free, as Explore counts it
    expect([counted(0.5).fullyAvailable, counted(0.5).freeCount]).toEqual([false, 0]);
    expect(counted(0.5).nights.map((night) => [night.state, night.reason])).toEqual([
      ['unknown', 'split'],
      ['unknown', 'split'],
    ]);
  });
});

describe("RAC's split stays on Explore (parkEntry)", () => {
  const BUSSELTON = racPark('busselton')!;
  /** A category as `check` gives it, of `kind`, from Busselton's answer edited by `edit`. */
  function category(
    id: number,
    kind: UnitKind,
    edit: (category: Record<string, unknown>) => void = () => undefined
  ): UnitAvailability {
    const raw = byId(
      busselton((c) => {
        if (c.category_id === id) edit(c);
      }),
      id
    );
    return {
      unitId: `cat:${id}`,
      unitName: raw.category_name,
      unitKind: kind,
      ...categoryAvailability(raw, NIGHTS),
    };
  }
  /** Free every night, on no one site. */
  const split = (c: Record<string, unknown>) =>
    Object.assign(c, { stay_through_sites_available: 0, stay_through_sites_code: 3 });
  /** The sold-out ensuite site with free sites every night. */
  const freeNights = (c: Record<string, unknown>) =>
    Object.assign(c, {
      sites_available: { '2026-11-06': 4, '2026-11-07': 3 },
      sites_code: { '2026-11-06': 0, '2026-11-07': 0 },
    });

  it('flags the park and the kind when nothing is free for the whole stay, but a category reports a split stay', () => {
    const units = [category(4, 'campsite', split), category(7, 'cabin')];
    expect(units[0].splitStay).toEqual({ booking: 'contact' });
    const entry = parkEntry('rac', BUSSELTON, units);
    expect(entry).toStrictEqual({
      key: 'rac:busselton',
      availableUnits: 0,
      splitStay: true,
      byKind: {
        campsite: { availableUnits: 0, splitStay: true },
        cabin: { availableUnits: 0 },
      },
    });
    expect(bulkSplitViolations([entry])).toEqual([]);
  });

  it('flags only its kind when a category of another kind is free for the whole stay', () => {
    const units = [
      category(4, 'campsite', split),
      category(7, 'cabin', (c) => {
        freeNights(c);
        Object.assign(c, { stay_through_sites_available: 2, stay_through_sites_code: 0 });
      }),
    ];
    const entry = parkEntry('rac', BUSSELTON, units);
    expect(entry).toStrictEqual({
      key: 'rac:busselton',
      availableUnits: 2,
      byKind: {
        campsite: { availableUnits: 0, splitStay: true },
        cabin: { availableUnits: 2 },
      },
    });
    expect(bulkSplitViolations([entry])).toEqual([]);
  });

  it('flags nothing when another category of the same kind is free for the whole stay', () => {
    const units = [
      category(4, 'campsite'),
      category(7, 'campsite', (c) => {
        freeNights(c);
        split(c);
      }),
    ];
    expect(units[1].splitStay).toEqual({ booking: 'contact' });
    expect(parkEntry('rac', BUSSELTON, units)).toStrictEqual({
      key: 'rac:busselton',
      availableUnits: 51,
      byKind: { campsite: { availableUnits: 51 }, cabin: { availableUnits: 0, bookableUnits: 0 } },
    });
  });

  it('flags nothing for split nights no tariff counts for: no split stay is reported', () => {
    const units = [
      category(4, 'campsite', (c) => {
        split(c);
        for (const tariff of c.tariffs_available as Array<Record<string, unknown>>) {
          Object.assign(tariff, { tariff_success: 'false', tariff_code: 4 });
        }
      }),
    ];
    expect(units[0].nights.map((n) => n.reason)).toEqual(['split', 'split']);
    const entry = parkEntry('rac', BUSSELTON, units);
    expect(entry).not.toHaveProperty('splitStay');
    expect(entry.byKind?.campsite).toStrictEqual({ availableUnits: 0 });
  });
});
