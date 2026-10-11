import { screen, waitFor } from '@testing-library/react';
import type { SiteSnipeInput } from '../../../../shared/types/site-sniper.types';
import {
  ACCOUNT_REQUIRED_MANIFEST,
  SNIPE_PREFILL as PREFILL,
  snipeFlowApi as api,
} from '@tests/fixtures/renderer/snipes';
import { makeLocationDetail } from '@tests/fixtures/renderer/watches';
import { createMockApi, fail, ok } from '@tests/utils/renderer/createMockApi';
import { currentRoute, renderWithApp } from '@tests/utils/renderer/renderWithApp';

const FAKE_PLACE = makeLocationDetail({ key: 'fakestay:20', providerId: 'fakestay' });
const button = (name: string) => screen.getByRole('button', { name });
const sent = (mock: jest.Mock): SiteSnipeInput => mock.mock.calls[0][0];
const step = (name: RegExp) => screen.findByRole('heading', { level: 2, name });

describe('NewSnipePage: creating the snipe', () => {
  it('Create snipe sends the provider, place, units, YYYY-MM-DD stay, mode and ms timing, no user id', async () => {
    const mock = api();
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    await step(/Your stay$/);
    for (const name of ['Continue', 'Continue']) await user.click(button(name));
    await step(/Review$/);
    expect(
      screen.getByText(
        /Hold only what you will use\. Payment is always completed by you on ParkStay\./
      )
    ).toBeInTheDocument();
    await user.click(button('Create snipe'));

    await waitFor(() => expect(mock.snipes.create).toHaveBeenCalledTimes(1));
    expect(sent(mock.snipes.create)).toEqual({
      providerId: 'parkstay',
      name: 'Osprey Bay · Fri 11 – Sun 13 Dec 2099',
      location: { externalId: '20', name: 'Osprey Bay', areaName: 'Cape Range National Park' },
      stay: { arrival: '2099-12-11', departure: '2099-12-13', adults: 2 },
      stayParams: { gearType: 'all', numVehicles: 1 },
      releaseMode: 'daily_rollover',
      accessGateEnabled: true,
      leadTimeSeconds: 120,
      pollIntervalMs: 1500,
      windowDurationMs: 900_000,
      maxAttempts: 0,
    });
    await waitFor(() => expect(currentRoute()).toBe('/site-sniper/42'));
  });

  it('sends a scheduled release as the instant it is where the place is, and timing in ms', async () => {
    const mock = api();
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    await step(/Your stay$/);
    await user.click(button('Continue'));
    await step(/Release and timing$/);
    await user.click(screen.getByRole('radio', { name: 'At a scheduled time' }));
    await user.type(screen.getByLabelText('Release date'), '2099-11-03');
    await user.type(screen.getByLabelText('Release time (AWST)'), '10:00');
    await user.click(button('Advanced timing'));
    const every = screen.getByRole('textbox', { name: 'Check every (seconds)' });
    await user.clear(every);
    await user.type(every, '0.5');
    const keep = screen.getByRole('textbox', { name: 'Keep trying for (minutes)' });
    await user.clear(keep);
    await user.type(keep, '30');
    await user.click(screen.getByRole('checkbox', { name: 'Use ParkStay queue' }));
    for (const name of ['Continue', 'Create snipe']) await user.click(button(name));

    await waitFor(() => expect(mock.snipes.create).toHaveBeenCalled());
    const input = sent(mock.snipes.create);
    expect(input.releaseMode).toBe('scheduled');
    expect(input.releaseAt).toEqual(new Date('2099-11-03T02:00:00.000Z'));
    expect(input).toMatchObject({
      pollIntervalMs: 500,
      windowDurationMs: 1_800_000,
      accessGateEnabled: false,
    });
  });

  it('clears the release error once both the date and the time are filled in', async () => {
    const { user } = renderWithApp({ route: PREFILL, api: api() });
    await step(/Your stay$/);
    await user.click(button('Continue'));
    await step(/Release and timing$/);
    await user.click(screen.getByRole('radio', { name: 'At a scheduled time' }));
    const date = screen.getByLabelText('Release date');
    await user.type(date, '2099-11-03');
    await user.tab();
    await waitFor(() =>
      expect(date).toHaveAccessibleDescription(/Enter the release date and time/)
    );
    await user.type(screen.getByLabelText('Release time (AWST)'), '10:00');
    await waitFor(() => expect(date).not.toHaveAttribute('aria-invalid', 'true'));
  });

  it('refuses a scheduled release in the past, and shows main’s release-time issue on its field', async () => {
    const create = jest.fn().mockResolvedValue({
      success: false,
      code: 'VALIDATION',
      error: 'ParkStay could not work out the release',
      issues: ['releaseAt'],
    });
    const mock = api({ snipes: { create } });
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    await step(/Your stay$/);
    await user.click(button('Continue'));
    await step(/Release and timing$/);
    await user.click(screen.getByRole('radio', { name: 'At a scheduled time' }));
    const date = screen.getByLabelText('Release date');
    await user.type(date, '2020-01-07');
    await user.type(screen.getByLabelText('Release time (AWST)'), '10:00');
    await user.click(button('Continue'));
    await waitFor(() => expect(date).toHaveFocus());
    expect(date).toHaveAccessibleDescription(/Choose a release time in the future/);

    await user.clear(date);
    await user.type(date, '2099-11-03');
    for (const name of ['Continue', 'Create snipe']) await user.click(button(name));
    expect(await step(/Release and timing$/)).toBeInTheDocument();
    expect(screen.getByLabelText('Release date')).toHaveAccessibleDescription(
      /ParkStay could not work out the release/
    );
  });

  it('refuses a scheduled release after check-in', async () => {
    const { user } = renderWithApp({ route: PREFILL, api: api() });
    await step(/Your stay$/);
    await user.click(button('Continue'));
    await step(/Release and timing$/);
    await user.click(screen.getByRole('radio', { name: 'At a scheduled time' }));
    const date = screen.getByLabelText('Release date');
    await user.type(date, '2099-12-11');
    await user.type(screen.getByLabelText('Release time (AWST)'), '10:00');
    await user.click(button('Continue'));
    await waitFor(() => expect(date).toHaveFocus());
    expect(date).toHaveAccessibleDescription(/Choose a release time before check-in/);
  });

  it('shows main’s release issue for a computed release on the release choice', async () => {
    const create = jest.fn().mockResolvedValue({
      success: false,
      code: 'VALIDATION',
      error: 'ParkStay could not work out when these dates open',
      issues: ['releaseAt'],
    });
    const { user } = renderWithApp({ route: PREFILL, api: api({ snipes: { create } }) });
    await step(/Your stay$/);
    for (const name of ['Continue', 'Continue', 'Create snipe']) await user.click(button(name));
    expect(await step(/Release and timing$/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'ParkStay could not work out when these dates open'
    );
  });

  it('asks to connect a provider whose holds need an account, and stops asking once signed in', async () => {
    const accounts = jest
      .fn()
      .mockResolvedValue(
        ok([{ providerId: 'fakestay', requirement: 'required-for-holds', status: 'signed-out' }])
      );
    const signIn = jest
      .fn()
      .mockResolvedValue(
        ok({ providerId: 'fakestay', requirement: 'required-for-holds', status: 'signed-in' })
      );
    const mock = createMockApi(
      api({ accounts: { list: accounts, signIn } }, [ACCOUNT_REQUIRED_MANIFEST], FAKE_PLACE)
    );
    const { user } = renderWithApp({
      route:
        '/site-sniper/new?provider=fakestay&location=20&arrival=2099-12-11&departure=2099-12-13',
      api: mock,
    });
    await step(/Your stay$/);
    await user.click(button('Continue'));
    await step(/Release and timing$/);
    await user.type(screen.getByLabelText('Release date'), '2099-11-03');
    await user.type(screen.getByLabelText(/^Release time/), '10:00');
    await user.click(button('Continue'));
    await step(/Review$/);
    await user.click(await screen.findByRole('button', { name: 'Connect Fake Stay' }));
    expect(signIn).toHaveBeenCalledWith('fakestay');
    accounts.mockResolvedValue(
      ok([{ providerId: 'fakestay', requirement: 'required-for-holds', status: 'signed-in' }])
    );
    mock.emit('account:updated', {
      providerId: 'fakestay',
      requirement: 'required-for-holds',
      status: 'signed-in',
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Connect Fake Stay' })).toBeNull()
    );
  });

  it('shows why a create failed when main gives no field', async () => {
    const create = jest.fn().mockResolvedValue(fail('ParkStay did not answer', 'PROVIDER_ERROR'));
    const mock = api({ snipes: { create } });
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    await step(/Your stay$/);
    for (const name of ['Continue', 'Continue', 'Create snipe']) await user.click(button(name));
    expect(await screen.findByText('ParkStay did not answer')).toBeInTheDocument();
    expect(currentRoute()).toMatch(/^\/site-sniper\/new/);
  });
});
