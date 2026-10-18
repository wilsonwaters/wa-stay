/**
 * The place page's booking rules for the dates in the card (`catalog.stayRules`), for a
 * provider that has them (Stay Rottnest): a refusal with why and dates to try, which set the
 * card's dates when pressed; a stay the rules allow, with its notes; a stay not on sale yet,
 * with when it opens (and Site Sniper's hand-off, which only sets reminders there). ParkStay, with no rules, shows none of it.
 */
import { configure, screen, waitFor, within } from '@testing-library/react';
import { placeDetail } from '../../../../tests/fixtures/catalog/place-detail';
import { placeApi } from '../../../../tests/utils/renderer/catalog';
import { ok, ROTTNEST_MANIFEST } from '../../../../tests/utils/renderer/createMockApi';
import { currentRoute, renderWithApp } from '../../../../tests/utils/renderer/renderWithApp';
import type { StayQuery, StayRulesVerdict } from '../../../shared/types/provider.types';

configure({ asyncUtilTimeout: 4000 });

const GEORDIE = placeDetail({
  key: 'rottnest:geordie-bay',
  providerId: 'rottnest',
  externalId: 'geordie-bay',
  name: 'Geordie Bay',
  kind: 'cabin',
  imageUrls: [],
  units: [{ unitId: 'GPV04', unitName: 'Geordie Bay Premium View - 4 Beds', unitKind: 'cabin' }],
  unitCount: 1,
  unitsAreTypes: true,
  releaseInfo: undefined,
});
const REFUSED: StayRulesVerdict = {
  ok: false,
  reason:
    'From 1 Dec 2099 to 29 Dec 2099, stays at Geordie Bay arrive and leave on fixed dates only, such as 8–15 Dec.',
  field: 'arrival',
  notes: [],
  release: { open: true, text: 'On sale.' },
  suggestions: [
    { arrival: '2099-12-08', departure: '2099-12-15' },
    { arrival: '2099-12-15', departure: '2099-12-22' },
  ],
};
const ALLOWED: StayRulesVerdict = {
  ok: true,
  notes: ["You'd arrive on a public holiday (Boxing Day, 26 Dec 2099)."],
  release: { open: true, text: 'On sale.' },
};
const NOT_YET: StayRulesVerdict = {
  ok: true,
  notes: [],
  release: {
    open: false,
    opensAt: '2099-04-01T00:30:00.000Z',
    text: "Opens Wed 1 Apr 2099, 8:30 am, Stay Rottnest's Open Day for December 2099. Its waiting room opens at 6 am.",
  },
};

function setup(answer: (stay: StayQuery) => StayRulesVerdict, providers = [ROTTNEST_MANIFEST]) {
  const stayRules = jest.fn(async (_key: string, stay: StayQuery) => ok(answer(stay)));
  const api = placeApi({
    detail: GEORDIE,
    items: [GEORDIE],
    catalog: { stayRules },
    stubs: {
      providers: {
        list: jest.fn().mockResolvedValue(ok(providers)),
        notice: jest
          .fn()
          .mockResolvedValue(
            ok({ providerId: 'rottnest', required: true, accepted: true, version: 1 })
          ),
      },
    },
  });
  const view = renderWithApp({
    route: '/places/rottnest/geordie-bay?arrival=2099-12-10&departure=2099-12-12&adults=2',
    api,
  });
  return { ...view, stayRules };
}

const card = () => screen.getByRole('region', { name: 'Check your dates' });
const rules = () => within(card()).getByRole('group', { name: "Stay Rottnest's booking rules" });

describe("Place page: the provider's booking rules", () => {
  it('a refusal says why, and its dates set the card when pressed', async () => {
    const { user, stayRules } = setup((stay) =>
      stay.arrival === '2099-12-10' ? REFUSED : ALLOWED
    );
    const notice = await within(card()).findByText(
      "Stay Rottnest's booking rules don't allow this stay"
    );
    expect(notice).toBeVisible();
    expect(rules()).toHaveTextContent(REFUSED.reason);
    expect(stayRules).toHaveBeenCalledWith(
      'rottnest:geordie-bay',
      expect.objectContaining({ arrival: '2099-12-10', departure: '2099-12-12', adults: 2 })
    );

    await user.click(within(rules()).getByRole('button', { name: 'Use 8–15 Dec' }));
    await waitFor(() => expect(currentRoute()).toContain('arrival=2099-12-08'));
    expect(currentRoute()).toContain('departure=2099-12-15');
    expect(
      await within(card()).findByText("Stay Rottnest's booking rules allow this stay.")
    ).toBeVisible();
    expect(rules()).toHaveTextContent(
      "You'd arrive on a public holiday (Boxing Day, 26 Dec 2099)."
    );
  });

  it('a stay not on sale yet says when it opens, and Site Sniper sets reminders for it', async () => {
    setup(() => NOT_YET);
    expect(await within(card()).findByText(NOT_YET.release!.text)).toBeVisible();
    // Every Stay Rottnest release mode only reminds (an Open Day plan): no "Snipe a …"
    const plan = within(card()).getByRole('link', { name: 'Set release reminders, coming soon' });
    expect(plan.getAttribute('href')).toMatch(
      /^#\/site-sniper\/new\?provider=rottnest&location=geordie-bay&arrival=2099-12-10&departure=2099-12-12/
    );
    expect(within(card()).queryByRole('link', { name: /^Snipe a/ })).toBeNull();
  });

  it('a provider without rules (main answers CAPABILITY) shows none of it', async () => {
    const { stayRules } = setup(() => ALLOWED);
    stayRules.mockResolvedValue({
      success: false,
      code: 'CAPABILITY',
      error: 'rottnest does not support stayRules',
    } as never);
    await screen.findByRole('heading', { level: 1, name: 'Geordie Bay' });
    await waitFor(() => expect(stayRules).toHaveBeenCalled());
    expect(within(card()).queryByRole('group', { name: /booking rules/ })).toBeNull();
  });
});
