import { screen, waitFor, within } from '@testing-library/react';
import type { LocationDetail } from '../../../../shared/types/catalog.types';
import type { SiteSnipeInput } from '../../../../shared/types/site-sniper.types';
import { SNIPE_PREFILL as PREFILL, snipeFlowApi } from '@tests/fixtures/renderer/snipes';
import { catalogGet, makeMixedDetail } from '@tests/fixtures/renderer/watches';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

const api = (detail: LocationDetail = makeMixedDetail()) =>
  snipeFlowApi({ catalog: { get: catalogGet(detail) } });
const button = (name: string) => screen.getByRole('button', { name });
const step = (name: RegExp) => screen.findByRole('heading', { level: 2, name });
const sent = (mock: jest.Mock): SiteSnipeInput => mock.mock.calls[0][0];
const stayTypes = () => screen.findByRole('group', { name: 'Stay type' });
const MESSAGE =
  'Choose a stay type or a site. At a place with more than one stay type, Site Sniper holds only what you choose.';

describe('NewSnipePage at a place with sites and cabins', () => {
  it('offers its stay types; "Cabins & villas" narrows the units and is sent as unitKinds', async () => {
    const mock = api();
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    await step(/Your stay$/);
    const group = await stayTypes();
    expect(
      within(group)
        .getAllByRole('button')
        .map((chip) => chip.textContent)
    ).toEqual(['Camping', 'Cabins & villas']);
    const cabins = within(group).getByRole('button', { name: 'Cabins & villas' });
    await user.click(cabins);
    expect(cabins).toHaveAttribute('aria-pressed', 'true');
    await user.click(button('Choose sites'));
    expect(screen.getByRole('checkbox', { name: 'Cabin 1' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Site 1' })).toBeNull();

    await user.click(button('Continue'));
    await step(/Release and timing$/);
    await user.click(button('Continue'));
    await step(/Review$/);
    const stay = screen.getByRole('region', { name: 'Stay' });
    expect(within(stay).getByText('Stay type')).toBeInTheDocument();
    expect(within(stay).getByText('Cabins & villas')).toBeInTheDocument();
    await user.click(button('Create snipe'));
    await waitFor(() => expect(mock.snipes.create).toHaveBeenCalledTimes(1));
    expect(sent(mock.snipes.create)).toMatchObject({ unitKinds: ['cabin'] });
    expect(sent(mock.snipes.create)).not.toHaveProperty('unitIds');
  });

  it('will not go on without a stay type or a site, focusing the stay types with why', async () => {
    const { user } = renderWithApp({ route: PREFILL, api: api() });
    const group = await stayTypes();
    await user.click(button('Continue'));
    await waitFor(() => expect(group).toHaveFocus());
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAccessibleDescription(`Leave all off for any stay type. ${MESSAGE}`);
    expect(screen.getByRole('heading', { level: 2, name: /Your stay$/ })).toBeInTheDocument();

    // A site meets it as well as a stay type, and the error goes.
    await user.click(button('Choose sites'));
    await user.click(screen.getByRole('checkbox', { name: 'Site 3' }));
    await waitFor(() => expect(screen.queryByText(MESSAGE)).toBeNull());
    expect(group).not.toHaveAttribute('aria-invalid');
    await user.click(button('Continue'));
    expect(await step(/Release and timing$/)).toBeInTheDocument();
  });

  it('goes on once a stay type is chosen', async () => {
    const { user } = renderWithApp({ route: PREFILL, api: api() });
    const group = await stayTypes();
    await user.click(button('Continue'));
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: 'Camping' }));
    await waitFor(() => expect(screen.queryByText(MESSAGE)).toBeNull());
    await user.click(button('Continue'));
    expect(await step(/Release and timing$/)).toBeInTheDocument();
  });

  it('asks for nothing at a place with sites only, as before', async () => {
    const { user } = renderWithApp({ route: PREFILL, api: api(makeMixedDetail({}, 'campsite')) });
    await screen.findByText('Preferred sites');
    expect(screen.queryByRole('group', { name: 'Stay type' })).toBeNull();
    await user.click(button('Continue'));
    expect(await step(/Release and timing$/)).toBeInTheDocument();
  });
});

describe('NewSnipePage: the stay types in a link from Explore', () => {
  it('stay=cabin chooses "Cabins & villas"', async () => {
    renderWithApp({ route: `${PREFILL}&stay=cabin`, api: api() });
    const group = await stayTypes();
    expect(within(group).getByRole('button', { name: 'Cabins & villas' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.queryByText("Some of the link couldn't be used")).toBeNull();
  });

  it('stay=bogus says the link’s stay type could not be used', async () => {
    renderWithApp({ route: `${PREFILL}&stay=bogus`, api: api() });
    const group = await stayTypes();
    expect(within(group).queryByRole('button', { pressed: true })).toBeNull();
    expect(
      screen.getByText("The link's stay type couldn't be used, so choose one.")
    ).toBeInTheDocument();
  });

  it('stay=cabin at a place with sites only is dropped without a word', async () => {
    const mock = api(makeMixedDetail({}, 'campsite'));
    const { user } = renderWithApp({ route: `${PREFILL}&stay=cabin`, api: mock });
    await screen.findByText('Preferred sites');
    expect(screen.queryByRole('group', { name: 'Stay type' })).toBeNull();
    expect(screen.queryByText("Some of the link couldn't be used")).toBeNull();
    for (const name of ['Continue', 'Continue', 'Create snipe']) await user.click(button(name));
    await waitFor(() => expect(mock.snipes.create).toHaveBeenCalled());
    expect(sent(mock.snipes.create)).not.toHaveProperty('unitKinds');
  });

  it('stay=cabin at a mixed place without cabins is dropped, saying so', async () => {
    renderWithApp({ route: `${PREFILL}&stay=cabin`, api: api(makeMixedDetail({}, 'dorm')) });
    const group = await stayTypes();
    expect(within(group).queryByRole('button', { pressed: true })).toBeNull();
    expect(
      await screen.findByText('Osprey Bay has no Cabins & villas, so choose a stay type.')
    ).toBeInTheDocument();
  });
});
