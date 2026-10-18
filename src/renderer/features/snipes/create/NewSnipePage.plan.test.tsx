/**
 * Open Day plans in the new-snipe flow (§12.38): in a mode that only reminds, the Release step
 * shows the stay's Open Day from the provider's booking rules (`catalog.stayRules`, asking the
 * provider nothing: no `catalog.checkLocation`), when each reminder comes and what to have
 * ready, with no "When the dates are free" choice or advanced timing; Review says it reminds;
 * and "Create plan" sends `action: 'remind'` with no timing. A stay on sale says so before a
 * plan is tried, with the reminders as days before the release; one the rules refuse says why
 * on the Stay step, whose suggested dates set the stay.
 */
import { screen, waitFor, within } from '@testing-library/react';
import type { StayRulesVerdict } from '../../../../shared/types/provider.types';
import type { SiteSnipeInput } from '../../../../shared/types/site-sniper.types';
import { makeSnipe } from '@tests/fixtures/renderer/snipes';
import { catalogGet, makeLocationDetail } from '@tests/fixtures/renderer/watches';
import { ok } from '@tests/utils/renderer/createMockApi';
import { ROTTNEST_MANIFEST } from '@tests/utils/renderer/manifests';
import { currentRoute, renderWithApp } from '@tests/utils/renderer/renderWithApp';

/** Wed 4 Nov 2099, 8:30 am Perth: the plan's Open Day. */
const OPEN_DAY = '2099-11-04T00:30:00.000Z';
const OPENS =
  "Opens Wed 4 Nov 2099, 8:30 am, Stay Rottnest's Open Day for July. Its waiting room opens at 6 am.";
const ROUTE =
  '/site-sniper/new?provider=rottnest&location=geordie-bay&arrival=2099-07-06&departure=2099-07-08&adults=2';
const PLACE = makeLocationDetail({
  key: 'rottnest:geordie-bay',
  providerId: 'rottnest',
  externalId: 'geordie-bay',
  name: 'Geordie Bay',
  areaName: 'Rottnest Island',
  units: [],
});

const notOnSale: StayRulesVerdict = {
  ok: true,
  notes: [],
  release: { open: false, opensAt: OPEN_DAY, text: OPENS },
};

function api(verdict: StayRulesVerdict = notOnSale) {
  const created = makeSnipe({
    id: 42,
    providerId: 'rottnest',
    action: 'remind',
    releaseMode: 'open_day',
  });
  return {
    providers: { list: jest.fn().mockResolvedValue(ok([ROTTNEST_MANIFEST])) },
    catalog: {
      get: catalogGet(PLACE),
      search: jest.fn().mockResolvedValue(ok({ items: [PLACE], total: 1 })),
      stayRules: jest.fn().mockResolvedValue(ok(verdict)),
      checkLocation: jest.fn(),
    },
    snipes: {
      list: jest.fn().mockResolvedValue(ok([])),
      create: jest.fn().mockResolvedValue(ok(created)),
      get: jest.fn().mockResolvedValue(ok(created)),
    },
  };
}

const button = (name: string) => screen.getByRole('button', { name });
const step = (name: RegExp) => screen.findByRole('heading', { level: 2, name });
const sent = (mock: jest.Mock): SiteSnipeInput => mock.mock.calls[0][0];

async function toRelease(mock: ReturnType<typeof api>) {
  const view = renderWithApp({ route: ROUTE, api: mock });
  await step(/Your stay$/);
  await view.user.click(button('Continue'));
  await step(/Release and timing$/);
  return view;
}

describe('NewSnipePage: an Open Day plan', () => {
  it('shows the Open Day, the reminders at their times and the checklist, asking the provider nothing', async () => {
    const mock = api();
    await toRelease(mock);
    const mode = screen.getByRole('radio', { name: /On its Open Day/ });
    expect(mode).toBeChecked();
    expect(await screen.findByText(OPENS)).toBeInTheDocument();

    const reminders = screen.getByRole('region', { name: 'Your reminders' });
    const rows = within(reminders)
      .getAllByRole('listitem')
      .map((row) => row.firstChild?.textContent);
    expect(rows).toEqual([
      'Tue 3 Nov, 6:00 pm AWST · Open Day tomorrow',
      'Wed 4 Nov, 6:00 am AWST · The waiting room is open',
      'Wed 4 Nov, 8:15 am AWST · 15 minutes to Open Day',
    ]);
    expect(reminders).toHaveTextContent(
      "Site Sniper only reminds you: it doesn't check Stay Rottnest, wait in its queue or book for you."
    );
    const ready = screen.getByRole('region', { name: 'Have ready' });
    expect(within(ready).getByText('A Visa or Mastercard.')).toBeInTheDocument();

    // A plan has nothing to choose about free dates, and no timing
    expect(screen.queryByRole('radio', { name: 'Alert me' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Advanced timing' })).toBeNull();
    expect(mock.catalog.stayRules).toHaveBeenCalledWith(
      'rottnest:geordie-bay',
      expect.objectContaining({ arrival: '2099-07-06', departure: '2099-07-08', adults: 2 })
    );
    expect(mock.catalog.checkLocation).not.toHaveBeenCalled();
  });

  it('Review says it reminds, and Create plan sends action remind with no timing', async () => {
    const mock = api();
    const { user } = await toRelease(mock);
    await user.click(button('Continue'));
    await step(/Review$/);
    const release = screen.getByRole('region', { name: 'Release' });
    expect(within(release).getByText('What it does')).toBeInTheDocument();
    expect(within(release).getByText('Reminds you before the release')).toBeInTheDocument();
    expect(within(release).getByText(`On its Open Day. ${OPENS}`)).toBeInTheDocument();
    expect(within(release).queryByText('When the dates are free')).toBeNull();
    await user.click(button('Create plan'));

    await waitFor(() => expect(mock.snipes.create).toHaveBeenCalledTimes(1));
    const input = sent(mock.snipes.create);
    expect(input).toMatchObject({
      providerId: 'rottnest',
      location: { externalId: 'geordie-bay', name: 'Geordie Bay' },
      stay: { arrival: '2099-07-06', departure: '2099-07-08', adults: 2 },
      releaseMode: 'open_day',
      action: 'remind',
    });
    for (const key of ['leadTimeSeconds', 'pollIntervalMs', 'windowDurationMs', 'maxAttempts']) {
      expect(input).not.toHaveProperty(key);
    }
    expect(await screen.findByText('Plan created')).toBeInTheDocument();
    await waitFor(() => expect(currentRoute()).toBe('/site-sniper/42'));
    expect(mock.catalog.checkLocation).not.toHaveBeenCalled();
  });

  it('a stay on sale says so, and the reminders read as days before the release', async () => {
    const mock = api({ ok: true, notes: [], release: { open: true, text: 'On sale.' } });
    await toRelease(mock);
    expect(
      await screen.findByText(
        'These dates are already on sale: book them on Stay Rottnest now, or set a watch for a cancellation.'
      )
    ).toBeInTheDocument();
    const reminders = screen.getByRole('region', { name: 'Your reminders' });
    expect(
      within(reminders)
        .getAllByRole('listitem')
        .map((row) => row.firstChild?.textContent)
    ).toEqual([
      'The day before, 6:00 pm · Open Day tomorrow',
      'On the day, 6:00 am · The waiting room is open',
      'On the day, 8:15 am · 15 minutes to Open Day',
    ]);
  });

  it('a stay the booking rules refuse says why on the Stay step, whose suggested dates set the stay', async () => {
    const reason =
      'From 1 Jul 2099 to 29 Jul 2099, stays at Geordie Bay arrive and leave on fixed dates only, such as 7–14 July.';
    const mock = api();
    mock.catalog.stayRules.mockImplementation(async (_key: string, stay: { arrival: string }) =>
      stay.arrival === '2099-07-06'
        ? ok({
            ok: false,
            reason,
            field: 'arrival',
            notes: [],
            suggestions: [{ arrival: '2099-07-07', departure: '2099-07-14' }],
          })
        : ok(notOnSale)
    );
    const { user } = renderWithApp({ route: ROUTE, api: mock });
    await step(/Your stay$/);
    const rules = await screen.findByRole('group', { name: "Stay Rottnest's booking rules" });
    expect(rules).toHaveTextContent(reason);
    await user.click(within(rules).getByRole('button', { name: 'Use 7–14 July' }));
    expect(
      await screen.findByText("Stay Rottnest's booking rules allow this stay.")
    ).toBeInTheDocument();
    expect(mock.catalog.stayRules).toHaveBeenLastCalledWith(
      'rottnest:geordie-bay',
      expect.objectContaining({ arrival: '2099-07-07', departure: '2099-07-14' })
    );
    // On the Release step, the refusal is gone with the dates
    await user.click(button('Continue'));
    await step(/Release and timing$/);
    expect(await screen.findByText(OPENS)).toBeInTheDocument();
    expect(screen.queryByText(reason)).toBeNull();
    expect(mock.catalog.checkLocation).not.toHaveBeenCalled();
  });
});
