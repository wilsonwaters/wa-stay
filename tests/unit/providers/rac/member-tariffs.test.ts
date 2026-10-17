/**
 * Members' tariffs (`src/main/providers/rac/mapping.ts`; terms rule 14, RS8): one classifier
 * (`isMemberTariff`, by label or short description) checked on every tariff in RAC's fixtures,
 * and the matrix of a member number (saved or not) against the tariffs' states, on Busselton's
 * powered site (6–7 Nov 2026: Standard Rate 75 a night, RAC Member Rate 68):
 * - without a number a stay is free only through a public tariff RAC took, priced by the
 *   cheapest of them; members' tariffs are never free and never a price;
 * - with one, members' tariffs count too: the cheapest tariff RAC took gives the prices, noted
 *   "RAC member rate" when it is a members' one, and a stay only members' tariffs take (a
 *   pre-sale, or a members' promotion) is free;
 * - a refused tariff, and NewBook's `999` placeholder, never give a price.
 */

import fs from 'fs';
import path from 'path';
import {
  categoryAvailability,
  isMemberTariff,
  RAC_MEMBER_PRICE_NOTE,
  readAvailability,
  type RawCategory,
} from '@main/providers/rac/mapping';

const FIXTURE_DIRS = [
  path.join(__dirname, '../../../fixtures/providers/rac'),
  path.join(__dirname, '../../../e2e/fixtures/http/rac'),
];
const NIGHTS = ['2026-11-06', '2026-11-07'];

type RawTariff = Record<string, unknown> & { tariffs_quoted: Record<string, { amount: unknown }> };
type RawAnswer = { data: Record<string, { tariffs_available: RawTariff[] }> };

/** Every recorded availability answer's categories. */
function fixtureCategories(): Array<[string, RawCategory]> {
  return FIXTURE_DIRS.flatMap((dir) =>
    fs
      .readdirSync(dir)
      .filter((file) => file.startsWith('availability-') && file.endsWith('.json'))
      .flatMap((file) => {
        const reading = readAvailability(fs.readFileSync(path.join(dir, file), 'utf8'));
        if (!reading.ok) throw new Error(`${file}: ${reading.why}`);
        return reading.categories.map((category): [string, RawCategory] => [file, category]);
      })
  );
}

/** Busselton's powered site, with its tariffs changed by `edit` (standard, member, promotion). */
function poweredSite(edit: (tariffs: RawTariff[]) => void = () => undefined): RawCategory {
  const json = JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIRS[0], 'availability-busselton-2026-11-06-2n.json'), 'utf8')
  ) as RawAnswer;
  edit(json.data['4'].tariffs_available);
  const reading = readAvailability(JSON.stringify(json));
  if (!reading.ok) throw new Error(reading.why);
  const category = reading.categories.find((c) => String(c.category_id) === '4');
  if (!category) throw new Error('no powered site');
  return category;
}

/** A tariff RAC refused with `code` (its total the placeholder, as RAC sends it). */
function refuse(tariff: RawTariff, code: number, message = 'This Rate is Stop Sold'): void {
  Object.assign(tariff, {
    tariff_success: 'false',
    tariff_code: code,
    tariff_message: message,
    tariff_total: 999,
  });
}

const [STANDARD, MEMBER, PROMOTION] = [0, 1, 2];

/** What a person with (or without) a member number is shown for the powered site. */
function shown(category: RawCategory, member: boolean) {
  const unit = categoryAvailability(category, NIGHTS, { member });
  return {
    free: unit.fullyAvailable,
    prices: unit.nights.map((night) => night.price),
    total: unit.total,
    note: unit.priceNote,
  };
}

describe("isMemberTariff: one classifier, on every tariff in RAC's fixtures", () => {
  /** Every label the fixtures hold, and whether it is a members' tariff. */
  const KNOWN: Record<string, boolean> = {
    'Standard Rate': false,
    'RAC Member Rate': true,
    'Stay & Save This Spring': false,
    'Stay & Save This Spring - RAC Member': true,
  };

  it('classifies every tariff of every recorded answer, and each label is known', () => {
    const seen = new Map<string, boolean>();
    let count = 0;
    for (const [file, category] of fixtureCategories()) {
      for (const tariff of category.tariffs_available ?? []) {
        count++;
        const label = tariff.tariff_label;
        expect([file, label, label in KNOWN]).toEqual([file, label, true]);
        expect([file, label, isMemberTariff(tariff)]).toEqual([file, label, KNOWN[label]]);
        seen.set(label, isMemberTariff(tariff));
      }
    }
    expect(count).toBeGreaterThan(100);
    expect(Object.fromEntries(seen)).toEqual(KNOWN);
  });

  it('reads a short description too: "Exclusive to RAC WA members" is a members\' tariff', () => {
    expect(
      isMemberTariff({
        tariff_label: 'Spring Special',
        tariff_short_description: 'Exclusive to RAC WA members',
      })
    ).toBe(true);
    for (const description of [
      'Our most flexible rate',
      'Open to non-members',
      'Non-Member Saver',
      undefined,
    ]) {
      expect(
        isMemberTariff({ tariff_label: 'Spring Special', tariff_short_description: description })
      ).toBe(false);
    }
  });

  it("keeps the short description out of what it gives: it only classifies (RAC's copy)", () => {
    const site = categoryAvailability(
      poweredSite((tariffs) => {
        tariffs[MEMBER].tariff_short_description = 'Exclusive to RAC WA members';
      }),
      NIGHTS,
      { member: true }
    );
    expect(JSON.stringify(site)).not.toContain('Exclusive');
  });
});

describe('the tariffs that count, with a member number or without (rule 14)', () => {
  it('Busselton as recorded: 75 a night (150) without a number, 68 (136) "RAC member rate" with one', () => {
    const site = poweredSite();
    expect(shown(site, false)).toEqual({
      free: true,
      prices: [75, 75],
      total: 150,
      note: undefined,
    });
    expect(shown(site, true)).toEqual({
      free: true,
      prices: [68, 68],
      total: 136,
      note: RAC_MEMBER_PRICE_NOTE,
    });
    expect(RAC_MEMBER_PRICE_NOTE).toBe('RAC member rate');
  });

  it('the standard rate sold out (stop sold) and the member rate bookable: free only with a number', () => {
    const site = poweredSite((tariffs) => refuse(tariffs[STANDARD], 11));
    const everyone = categoryAvailability(site, NIGHTS, { member: false });
    expect(everyone.fullyAvailable).toBe(false);
    expect(everyone.nights.map((night) => [night.state, night.price])).toEqual([
      ['closed', undefined],
      ['closed', undefined],
    ]);
    expect(everyone.total).toBeUndefined();
    expect(shown(site, true)).toEqual({
      free: true,
      prices: [68, 68],
      total: 136,
      note: RAC_MEMBER_PRICE_NOTE,
    });
  });

  it.each([
    [5, 'Bookings for this Rate are not available yet'],
    [6, 'This Rate has a 3 Night Minimum'],
    [8, 'Bookings are not allowed to Arrive on 6 Nov 2026'],
    [11, 'This Rate is Stop Sold'],
  ])(
    'the member rate refused (code %p) and the standard bookable: free at the standard price, no note, either way',
    (code, message) => {
      const site = poweredSite((tariffs) => refuse(tariffs[MEMBER], code, message));
      for (const member of [false, true]) {
        expect(shown(site, member)).toEqual({
          free: true,
          prices: [75, 75],
          total: 150,
          note: undefined,
        });
      }
    }
  );

  it('only a members\' promotion bookable ("Stay & Save … - RAC Member"): free with a number, noted', () => {
    const site = poweredSite((tariffs) => {
      refuse(tariffs[STANDARD], 11);
      refuse(tariffs[MEMBER], 11);
      Object.assign(tariffs[PROMOTION], {
        tariff_label: 'Stay & Save This Spring - RAC Member',
        tariff_success: 'true',
        tariff_code: 0,
        tariff_message: '',
        tariff_total: 120,
      });
      for (const quote of Object.values(tariffs[PROMOTION].tariffs_quoted)) {
        Object.assign(quote, { amount: 60, minimum_periods: '1' });
      }
    });
    expect(shown(site, false).free).toBe(false);
    expect(shown(site, false).prices).toEqual([undefined, undefined]);
    expect(shown(site, true)).toEqual({
      free: true,
      prices: [60, 60],
      total: 120,
      note: RAC_MEMBER_PRICE_NOTE,
    });
  });

  it("a pre-sale that lists only members' tariffs is free for a member (RS8), and decided by them", () => {
    const onlyMembers = (tariffs: RawTariff[]) =>
      tariffs.splice(0, tariffs.length, tariffs[MEMBER]);
    const presale = poweredSite(onlyMembers);
    expect(shown(presale, true)).toMatchObject({ free: true, total: 136 });
    expect(shown(presale, false).free).toBe(false);
    // Refused for everyone: a member's verdict comes from the members' tariff (not released)
    const unreleased = poweredSite((tariffs) => {
      onlyMembers(tariffs);
      refuse(tariffs[0], 5, 'Bookings for this Rate are not available yet');
    });
    const member = categoryAvailability(unreleased, NIGHTS, { member: true });
    expect(member.nights.map((night) => night.state)).toEqual(['not-released', 'not-released']);
  });

  it('the cheaper public tariff wins over a dearer member rate, with no member note', () => {
    const site = poweredSite((tariffs) => {
      Object.assign(tariffs[PROMOTION], {
        tariff_success: 'true',
        tariff_code: 0,
        tariff_message: '',
        tariff_total: 120,
      });
      for (const quote of Object.values(tariffs[PROMOTION].tariffs_quoted)) {
        Object.assign(quote, { amount: 60, minimum_periods: '1' });
      }
    });
    expect(shown(site, true)).toEqual({
      free: true,
      prices: [60, 60],
      total: 120,
      note: 'Stay & Save This Spring',
    });
  });

  it("never prices from a refused tariff's placeholder total or NewBook's 999 night amount", () => {
    // Refused tariffs carry 999 totals: never the price, for anyone
    const refused = poweredSite((tariffs) => refuse(tariffs[MEMBER], 11));
    expect(shown(refused, true).total).toBe(150);
    // A member rate RAC took, quoting 999 for a night it has no rate for yet: no price, no total
    const placeholder = poweredSite((tariffs) => {
      tariffs[MEMBER].tariffs_quoted['2026-11-07'].amount = 999;
      tariffs[MEMBER].tariff_total = 999 + 68;
    });
    // The member rate is not the cheapest any more (1067 against 150): the standard prices it
    expect(shown(placeholder, true)).toEqual({
      free: true,
      prices: [75, 75],
      total: 150,
      note: undefined,
    });
    const memberOnly = poweredSite((tariffs) => {
      refuse(tariffs[STANDARD], 11);
      tariffs[MEMBER].tariffs_quoted['2026-11-07'].amount = 999;
    });
    expect(shown(memberOnly, true)).toEqual({
      free: true,
      prices: [68, undefined],
      total: undefined,
      note: RAC_MEMBER_PRICE_NOTE,
    });
  });
});
