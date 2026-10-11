import { screen, waitFor, within } from '@testing-library/react';
import type { SiteSnipeInput } from '../../../../shared/types/site-sniper.types';
import {
  checkLocationWith,
  SNIPE_PREFILL as PREFILL,
  snipeFlowApi as api,
} from '@tests/fixtures/renderer/snipes';
import { catalogGet, makeLocationDetail } from '@tests/fixtures/renderer/watches';
import { FAKE_MANIFEST, ok, PARKSTAY_MANIFEST } from '@tests/utils/renderer/createMockApi';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

const button = (name: string) => screen.getByRole('button', { name });
const sent = (mock: jest.Mock): SiteSnipeInput => mock.mock.calls[0][0];
const step = (name: RegExp) => screen.findByRole('heading', { level: 2, name });

describe('NewSnipePage', () => {
  it('lists only the providers that offer Site Sniper, the single one chosen for you', async () => {
    const { user } = renderWithApp({ route: '/site-sniper/new', api: api() });
    expect(await screen.findByRole('heading', { level: 1, name: 'New snipe' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('radio', { name: 'ParkStay WA' })).toBeChecked());
    expect(screen.queryByRole('radio', { name: 'Fake Stay Holidays' })).toBeNull();
    await user.click(button('Continue'));
    // The heading takes focus in an effect after the step renders.
    const location = await step(/Location$/);
    await waitFor(() => expect(location).toHaveFocus());
  });

  it('lists the place’s units as checkboxes, never a free-text site id', async () => {
    const { user } = renderWithApp({ route: PREFILL, api: api() });
    await step(/Your stay$/);
    expect(screen.getByText('Any site.', { exact: false })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Choose sites' }));
    expect(screen.getByRole('checkbox', { name: 'Site 1' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'All Unpowered (2)' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /site/i })).toBeNull();
    expect(screen.getByRole('textbox', { name: /Postcode/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Vehicles' })).toBeInTheDocument();
  });

  it('warns when the party is bigger than the chosen sites hold, and still goes on', async () => {
    const small = makeLocationDetail({
      units: [
        { unitId: '1', unitName: 'Site 1', unitType: 'Tent', maxPeople: 2 },
        { unitId: '2', unitName: 'Site 2', unitType: 'Caravan', maxPeople: 6 },
      ],
    });
    const route = PREFILL.replace('adults=2', 'adults=4');
    const { user } = renderWithApp({ route, api: api({ catalog: { get: catalogGet(small) } }) });
    await step(/Your stay$/);
    await user.click(await screen.findByRole('button', { name: 'Choose sites' }));
    await user.click(screen.getByRole('checkbox', { name: /Site 1/ }));
    expect(
      screen.getByText(
        /Your party of 4 is more than the chosen sites are known to hold \(up to 2\)/
      )
    ).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Site 2/ }));
    expect(screen.queryByText(/Your party of 4/)).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: /Site 2/ }));
    await user.click(button('Continue'));
    expect(await step(/Release and timing$/)).toBeInTheDocument();
  });

  it('lists a class-listed place’s classes as units and sends the class id', async () => {
    const classes = makeLocationDetail({
      units: [
        { unitId: 'class:12', unitName: 'Camp site (no power)', unitType: 'Camp site (no power)' },
        { unitId: 'class:13', unitName: 'Powered site', unitType: 'Powered site' },
      ],
    });
    const mock = api({ catalog: { get: catalogGet(classes) } });
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    await step(/Your stay$/);
    await user.click(await screen.findByRole('button', { name: 'Choose sites' }));
    await user.click(screen.getByRole('checkbox', { name: 'Powered site' }));
    for (const name of ['Continue', 'Continue', 'Create snipe']) await user.click(button(name));
    await waitFor(() => expect(mock.snipes.create).toHaveBeenCalled());
    expect(sent(mock.snipes.create).unitIds).toEqual(['class:13']);
  });

  it('explains each release mode, with the place’s rule and when the first night opens', async () => {
    const { user } = renderWithApp({ route: PREFILL, api: api() });
    await step(/Your stay$/);
    await user.click(button('Continue'));
    await step(/Release and timing$/);
    const group = screen.getByRole('radiogroup', { name: 'When are the sites released?' });
    expect(group).toHaveAccessibleDescription(
      'Osprey Bay: Bookings open 180 days ahead at 12:00 am AWST'
    );
    const rollover = within(group).getByRole('radio', { name: 'When new dates open' });
    expect(rollover).toBeChecked();
    await waitFor(() =>
      expect(rollover).toHaveAccessibleDescription(
        /Sites for Fri 11 Dec 2099 open Mon 15 Jun 2099, 12:00 am AWST \(in \d+ days\)\./
      )
    );
    expect(
      within(group).getByRole('radio', { name: 'When someone cancels' })
    ).toHaveAccessibleDescription('Keeps checking for a site that comes free.');
    expect(button('Advanced timing')).toHaveAttribute('aria-expanded', 'false');
  });

  it('says the release time is unknown when the provider gives none', async () => {
    const mock = api({ catalog: { checkLocation: checkLocationWith({ open: false }) } });
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    await step(/Your stay$/);
    await user.click(button('Continue'));
    expect(
      await screen.findByText('Release time unknown. Site Sniper will keep checking.')
    ).toBeInTheDocument();
  });

  it('drops the parts of a link it cannot use, saying why', async () => {
    renderWithApp({
      route:
        '/site-sniper/new?provider=fakestay&location=20&arrival=2000-01-01&departure=2000-01-03',
      api: api({
        providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST, FAKE_MANIFEST])) },
      }),
    });
    const notice = await screen.findByText("Some of the link couldn't be used");
    const list = notice.closest('[role="status"]') as HTMLElement;
    expect(
      within(list).getByText("Fake Stay doesn't offer Site Sniper, so choose a provider.")
    ).toBeInTheDocument();
    expect(within(list).getByText(/The link's dates couldn't be used/)).toBeInTheDocument();
  });
});
