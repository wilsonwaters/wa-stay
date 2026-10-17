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
// R9: "one stay type", and the mixed place's noun
const MESSAGE =
  'Choose one stay type or a spot. At a place with more than one stay type, Site Sniper holds only what you choose.';

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
    // Only cabins listed now: the units are cabins (R9)
    await user.click(button('Choose cabins'));
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

  it('the Stay step goes on without a stay type or a spot; "Hold it for me" then refuses on the Release step, focusing the choice with why', async () => {
    const { user } = renderWithApp({ route: PREFILL, api: api() });
    const group = await stayTypes();
    await user.click(button('Continue'));
    await step(/Release and timing$/);
    expect(group).not.toBeInTheDocument();

    // ParkStay holds by default, so the choice refuses Continue with R6's message
    const choice = screen.getByRole('radiogroup', { name: 'When the dates are free' });
    expect(within(choice).getByRole('radio', { name: 'Hold it for me' })).toBeChecked();
    await user.click(button('Continue'));
    await waitFor(() => expect(choice).toHaveFocus());
    expect(choice).toHaveAttribute('aria-invalid', 'true');
    expect(choice).toHaveAccessibleDescription(MESSAGE);
    expect(
      screen.getByRole('heading', { level: 2, name: /Release and timing$/ })
    ).toBeInTheDocument();

    // "Alert me" needs neither: the message goes, and it goes on
    await user.click(within(choice).getByRole('radio', { name: 'Alert me' }));
    await waitFor(() => expect(screen.queryByText(MESSAGE)).toBeNull());
    expect(choice).not.toHaveAttribute('aria-invalid');
    await user.click(button('Continue'));
    expect(await step(/Review$/)).toBeInTheDocument();
  });

  it('switching to "Hold it for me" shows the message at once; a spot chosen under "Your stay" meets it', async () => {
    const mock = api();
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    await stayTypes();
    await user.click(button('Continue'));
    await step(/Release and timing$/);
    const choice = screen.getByRole('radiogroup', { name: 'When the dates are free' });
    await user.click(within(choice).getByRole('radio', { name: 'Alert me' }));
    await user.click(within(choice).getByRole('radio', { name: 'Hold it for me' }));
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument();

    // Back to the stay: a site meets the rule as well as a stay type, and the message goes
    await user.click(screen.getByRole('button', { name: /^Your stay/ }));
    await step(/Your stay$/);
    await user.click(button('Choose spots'));
    await user.click(screen.getByRole('checkbox', { name: 'Site 3' }));
    await user.click(button('Continue'));
    await step(/Release and timing$/);
    expect(screen.queryByText(MESSAGE)).toBeNull();
    await user.click(button('Continue'));
    await step(/Review$/);
    await user.click(button('Create snipe'));
    await waitFor(() => expect(mock.snipes.create).toHaveBeenCalledTimes(1));
    expect(sent(mock.snipes.create)).toMatchObject({ action: 'hold', unitIds: ['3'] });
  });

  it('a stay type chosen meets the hold rule too', async () => {
    const { user } = renderWithApp({ route: PREFILL, api: api() });
    const group = await stayTypes();
    await user.click(within(group).getByRole('button', { name: 'Camping' }));
    await user.click(button('Continue'));
    await step(/Release and timing$/);
    await user.click(button('Continue'));
    expect(await step(/Review$/)).toBeInTheDocument();
    expect(screen.queryByText(MESSAGE)).toBeNull();
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
