/**
 * RAC's modules for a person with a member number saved, and without one (terms rule 14), as
 * the app builds them (`racFactory`: membership from the scoped vault, `membership.ts`), over
 * RAC's trimmed answers. Nothing is sent anywhere; every number is made up.
 *
 * - Prices on Busselton's powered site, 6–7 Nov 2026: 75 a night (150) without a number, 68
 *   (136) noted "RAC member rate" with one.
 * - The standard tariffs sold out and the member rate bookable: not free without a number (the
 *   check and Explore's count, 0), free with one.
 * - Release instants on a fake clock, for 20–21 Dec 2027 (the summer 2027–28 holidays):
 *   Busselton opens 8 am Perth on 5 Feb 2027 without a number and 3 Feb with one; Cable Beach
 *   and a Margaret River dorm open the same either way. A check's `release.opensAt` agrees.
 * - `links.booking`: the book-now page as a `member` or a `non-member`, never the number.
 */

import fs from 'fs';
import path from 'path';
import { RAC_PARKS, racFactory, racManifest } from '@main/providers/rac';
import { RAC_AVAILABILITY_PATH } from '@main/providers/rac/availability';
import { createRacLinks } from '@main/providers/rac/links';
import { RAC_MEMBER_NUMBER_SECRET } from '@main/providers/rac/membership';
import type { AccommodationProvider, HopRequest, ProviderContext } from '@main/providers/sdk';
import { SnipeReleaseMode } from '@shared/types/common.types';
import type { LocationAvailability, StayQuery, UnitKind } from '@shared/types/provider.types';
import { RecordingHttpClient, type HopAnswer } from '@tests/utils/fake-paced-provider';
import { createMemoryLogger, createTestProviderContext } from '@tests/utils/fake-provider';

const RAC_FIXTURES = path.join(__dirname, '../fixtures/providers/rac');
const NUMBER = '1234567890123';
/** 10 am in Perth, 17 Oct 2026. */
const NOW = new Date('2026-10-17T02:00:00.000Z');
const STAY: StayQuery = { arrival: '2026-11-06', departure: '2026-11-08', adults: 2 };
const HOLIDAYS: StayQuery = { arrival: '2027-12-20', departure: '2027-12-22', adults: 2 };

type RawAnswer = {
  data: Record<string, { tariffs_available: Array<Record<string, unknown>> }>;
};

const read = (file: string) => fs.readFileSync(path.join(RAC_FIXTURES, file), 'utf8');

/** Each park's recorded answer for 6–8 Nov 2026, Busselton's changed by `edit`. */
function answers(edit: (busselton: RawAnswer) => void = () => undefined) {
  return (hop: HopRequest): HopAnswer => {
    if (new URL(hop.url).pathname !== RAC_AVAILABILITY_PATH) return { status: 404 };
    const blog = new URLSearchParams(hop.body).get('blog_id');
    const park = RAC_PARKS.find((p) => String(p.blogId) === blog);
    if (!park) return { status: 404 };
    const text = read(`availability-${park.slug}-2026-11-06-2n.json`);
    if (park.slug !== 'busselton') return { body: text };
    const json = JSON.parse(text) as RawAnswer;
    edit(json);
    return { body: JSON.stringify(json) };
  };
}

/** RAC as the app builds it, at `now`, with the member number saved or not. */
async function rac({
  member,
  now = NOW,
  respond = answers(),
}: {
  member: boolean;
  now?: Date;
  respond?: (hop: HopRequest) => HopAnswer;
}): Promise<{ provider: AccommodationProvider; http: RecordingHttpClient; ctx: ProviderContext }> {
  const http = new RecordingHttpClient({ providerId: 'rac', respond });
  const ctx = createTestProviderContext(racManifest, {
    http,
    clock: () => now,
    logger: createMemoryLogger(),
  });
  if (member) await ctx.secrets.set(RAC_MEMBER_NUMBER_SECRET, NUMBER);
  return { provider: racFactory(ctx), http, ctx };
}

const powered = (result: LocationAvailability) => {
  const unit = result.units.find((u) => u.unitId === 'cat:4');
  if (!unit) throw new Error('no powered site');
  return unit;
};

describe('RAC prices with a member number, and without (rule 14)', () => {
  it('Busselton: 75 a night, 150, no note without a number; 68, 136, "RAC member rate" with one', async () => {
    const without = powered(
      await (await rac({ member: false })).provider.availability!.check('busselton', STAY)
    );
    expect([without.nights.map((n) => n.price), without.total, without.priceNote]).toEqual([
      [75, 75],
      150,
      undefined,
    ]);
    const withNumber = powered(
      await (await rac({ member: true })).provider.availability!.check('busselton', STAY)
    );
    expect([withNumber.nights.map((n) => n.price), withNumber.total, withNumber.priceNote]).toEqual(
      [[68, 68], 136, 'RAC member rate']
    );
  });

  it('the standard tariffs sold out and the member rate bookable: not free without a number (check and bulk), free with one', async () => {
    // Every public tariff of the powered site stop sold: only the member rate takes the stay
    const respond = answers((json) => {
      for (const tariff of json.data['4'].tariffs_available) {
        if (tariff.tariff_label === 'RAC Member Rate') continue;
        Object.assign(tariff, {
          tariff_success: 'false',
          tariff_code: 11,
          tariff_message: 'This Rate is Stop Sold',
          tariff_total: 999,
        });
      }
    });
    const everyone = await rac({ member: false, respond });
    const site = powered(await everyone.provider.availability!.check('busselton', STAY));
    expect(site.fullyAvailable).toBe(false);
    expect(site.nights.every((night) => night.price === undefined)).toBe(true);
    const counts = await everyone.provider.availability!.search!(STAY);
    // The ensuite is booked, the powered site is not free for a non-member: nothing free
    expect(counts.find((entry) => entry.key === 'rac:busselton')).toMatchObject({
      availableUnits: 0,
      byKind: { campsite: { availableUnits: 0 } },
    });

    const member = await rac({ member: true, respond });
    const free = powered(await member.provider.availability!.check('busselton', STAY));
    expect([free.fullyAvailable, free.total, free.priceNote]).toEqual([
      true,
      136,
      'RAC member rate',
    ]);
    const memberCounts = await member.provider.availability!.search!(STAY);
    expect(memberCounts.find((entry) => entry.key === 'rac:busselton')).toMatchObject({
      availableUnits: 51,
      byKind: { campsite: { availableUnits: 51 } },
    });
  });

  it('asks the vault at every check: a number saved or removed shows at the next one', async () => {
    const { provider, ctx } = await rac({ member: false });
    expect(powered(await provider.availability!.check('busselton', STAY)).total).toBe(150);
    await ctx.secrets.set(RAC_MEMBER_NUMBER_SECRET, NUMBER);
    expect(powered(await provider.availability!.check('busselton', STAY)).total).toBe(136);
    await ctx.secrets.delete(RAC_MEMBER_NUMBER_SECRET);
    expect(powered(await provider.availability!.check('busselton', STAY)).total).toBe(150);
  });
});

describe('RAC release instants with a member number, and without (fake clock, rule 14)', () => {
  /** When the stay opens at the park, for a snipe on `unitKinds`, asked at 10 am, 17 Oct 2026. */
  async function opensAt(externalId: string, member: boolean, unitKinds: UnitKind[] = []) {
    const { provider, http } = await rac({ member });
    const at = await provider.release!.computeReleaseAt({
      mode: SnipeReleaseMode.DAILY_ROLLOVER,
      externalId,
      stay: HOLIDAYS,
      unitKinds,
      now: NOW,
    });
    expect(http.requests).toEqual([]);
    return at?.toISOString();
  }

  it('Busselton: 8 am Perth on 5 Feb 2027 without a number, on 3 Feb 2027 with one', async () => {
    await expect(opensAt('busselton', false)).resolves.toBe('2027-02-05T00:00:00.000Z');
    await expect(opensAt('busselton', true)).resolves.toBe('2027-02-03T00:00:00.000Z');
  });

  it('Cable Beach (no school-holiday release) and a Margaret River dorm: the same either way', async () => {
    // Cable Beach: the rolling window only, 00:00 Perth on 22 Dec 2026 (departure − 365)
    for (const member of [false, true]) {
      await expect(opensAt('cable-beach', member)).resolves.toBe('2026-12-21T16:00:00.000Z');
    }
    // Margaret River's dorms are not in the pre-sale: its public hour, 7 am on 5 Feb 2027
    for (const member of [false, true]) {
      await expect(opensAt('margaret-river', member, ['dorm'])).resolves.toBe(
        '2027-02-04T23:00:00.000Z'
      );
    }
    // Its other stays are: 48 hours earlier with a number
    await expect(opensAt('margaret-river', true, ['campsite'])).resolves.toBe(
      '2027-02-02T23:00:00.000Z'
    );
  });

  it("a check's release.opensAt follows the same rule", async () => {
    const holidayAnswer = (hop: HopRequest): HopAnswer => ({
      body: (answers()(hop).body ?? '')
        .replaceAll('2026-11-06', '2027-12-20')
        .replaceAll('2026-11-07', '2027-12-21')
        .replaceAll('2026-11-08', '2027-12-22'),
    });
    const now = new Date('2027-01-20T02:00:00.000Z');
    const everyone = await rac({ member: false, now, respond: holidayAnswer });
    const member = await rac({ member: true, now, respond: holidayAnswer });
    await expect(
      everyone.provider.availability!.check('busselton', HOLIDAYS)
    ).resolves.toMatchObject({
      release: { open: false, opensAt: '2027-02-05T00:00:00.000Z' },
    });
    await expect(member.provider.availability!.check('busselton', HOLIDAYS)).resolves.toMatchObject(
      {
        release: { open: false, opensAt: '2027-02-03T00:00:00.000Z' },
      }
    );
  });
});

describe('RAC booking links with a member number, and without', () => {
  it('the book-now page says membership_type member or non-member, and never the number', async () => {
    const links = (member: boolean) => createRacLinks(() => member);
    const nonMember = new URL(links(false).booking('busselton', STAY)!);
    const member = new URL(links(true).booking('busselton', STAY)!);
    expect(nonMember.searchParams.get('membership_type')).toBe('non-member');
    expect(member.searchParams.get('membership_type')).toBe('member');
    // A category's booking page carries no membership at all
    expect(links(true).booking('busselton', STAY, 'cat:4')).toBe(
      links(false).booking('busselton', STAY, 'cat:4')
    );
  });

  it("as the app builds them: a check's link and links.booking follow the saved number", async () => {
    for (const saved of [false, true]) {
      const { provider, http } = await rac({ member: saved });
      const result = await provider.availability!.check('busselton', STAY);
      const type = saved ? 'member' : 'non-member';
      expect(new URL(result.bookingUrl!).searchParams.get('membership_type')).toBe(type);
      const link = provider.links.booking('busselton', STAY)!;
      expect(new URL(link).searchParams.get('membership_type')).toBe(type);
      for (const text of [
        result.bookingUrl,
        link,
        ...result.units.map((u) => u.bookingUrl),
        JSON.stringify(http.requests),
      ]) {
        expect(text).not.toContain(NUMBER);
      }
    }
  });
});
