/**
 * The Release step's "When the dates are free" (R13, RS9): where the provider places holds, a
 * radio group offers "Alert me" and "Hold it for me" (ParkStay holds by default); where it does
 * not, one line says the snipe alerts. Choosing "Alert me" hides what only a hold needs (the
 * account prompt, the hold's words), and choosing "Hold it for me" again shows it.
 */
import { act, screen, within } from '@testing-library/react';
import {
  ACCOUNT_REQUIRED_MANIFEST,
  ALERT_ONLY_MANIFEST,
  SNIPE_PREFILL as PREFILL,
  snipeFlowApi as api,
} from '@tests/fixtures/renderer/snipes';
import { makeLocationDetail } from '@tests/fixtures/renderer/watches';
import { createMockApi, ok } from '@tests/utils/renderer/createMockApi';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

const button = (name: string) => screen.getByRole('button', { name });
const step = (name: RegExp) => screen.findByRole('heading', { level: 2, name });
const placeOf = (providerId: string) => makeLocationDetail({ key: `${providerId}:20`, providerId });
const route = (providerId: string) =>
  `/site-sniper/new?provider=${providerId}&location=20&arrival=2099-12-11&departure=2099-12-13`;

async function toRelease(user: ReturnType<typeof renderWithApp>['user']) {
  await step(/Your stay$/);
  await user.click(button('Continue'));
  await step(/Release and timing$/);
}

describe('ReleaseStep: when the dates are free', () => {
  it('with ParkStay: a radio group of "Alert me" and "Hold it for me", each described by its card, holding by default', async () => {
    const { user } = renderWithApp({ route: PREFILL, api: api() });
    await toRelease(user);

    const choice = screen.getByRole('radiogroup', { name: 'When the dates are free' });
    const radios = within(choice).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('value'))).toEqual(['alert', 'hold']);
    const alert = within(choice).getByRole('radio', { name: 'Alert me' });
    const hold = within(choice).getByRole('radio', { name: 'Hold it for me' });
    expect(hold).toBeChecked();
    expect(alert).not.toBeChecked();
    expect(alert).toHaveAccessibleDescription(
      'A desktop alert and email with a link to book on ParkStay. Nothing is held, so book it before someone else does.'
    );
    expect(hold).toHaveAccessibleDescription(
      "Holds a site for you, then you pay on ParkStay's page in WA Stay."
    );
    expect(screen.queryByText(/Automatic holds aren't available/)).toBeNull();
  });

  it('with a provider without holds: no choice, one line saying it alerts', async () => {
    const { user } = renderWithApp({
      route: route('alertstay'),
      api: api({}, [ALERT_ONLY_MANIFEST], placeOf('alertstay')),
    });
    await toRelease(user);

    expect(screen.queryByRole('radiogroup', { name: 'When the dates are free' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Hold it for me' })).toBeNull();
    expect(
      screen.getByText(
        "When the dates are free, Site Sniper alerts you with a link to book on Alert Stay. Automatic holds aren't available for Alert Stay."
      )
    ).toBeInTheDocument();
  });

  it('"Alert me" needs no sign-in: no Connect prompt where holds need an account, until "Hold it for me" again', async () => {
    const accounts = jest
      .fn()
      .mockResolvedValue(
        ok([{ providerId: 'fakestay', requirement: 'required-for-holds', status: 'signed-out' }])
      );
    const mock = createMockApi(
      api({ accounts: { list: accounts } }, [ACCOUNT_REQUIRED_MANIFEST], placeOf('fakestay'))
    );
    const { user } = renderWithApp({ route: route('fakestay'), api: mock });
    await toRelease(user);
    await user.type(screen.getByLabelText('Release date'), '2099-11-03');
    await user.type(screen.getByLabelText(/^Release time/), '10:00');
    await user.click(screen.getByRole('radio', { name: 'Alert me' }));
    await user.click(button('Continue'));
    await step(/Review$/);
    // Nothing asks for the account: the prompt is not there to ask
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(accounts).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Connect Fake Stay' })).toBeNull();
    expect(screen.queryByText(/needs you signed in/)).toBeNull();

    // Back to hold: the prompt and the hold's words come back
    await user.click(button('Change the release'));
    await step(/Release and timing$/);
    await user.click(screen.getByRole('radio', { name: 'Hold it for me' }));
    await user.click(button('Continue'));
    await step(/Review$/);
    expect(await screen.findByRole('button', { name: 'Connect Fake Stay' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Release' })).getByText('Hold a site')
    ).toBeInTheDocument();
    expect(screen.getByText(/^Hold only what you will use\./)).toBeInTheDocument();
  });

  it('the Stay step’s hints follow the choice: "holds the first" for a hold, "alerts you to" for an alert', async () => {
    const { user } = renderWithApp({ route: PREFILL, api: api() });
    await step(/Your stay$/);
    expect(
      screen.getByText(/Leave all unticked and Site Sniper holds the first site that comes free\./)
    ).toBeInTheDocument();
    await user.click(button('Continue'));
    await step(/Release and timing$/);
    await user.click(screen.getByRole('radio', { name: 'Alert me' }));
    await user.click(screen.getByRole('button', { name: /^Your stay/ }));
    await step(/Your stay$/);
    expect(
      screen.getByText(
        /Leave all unticked and Site Sniper alerts you to the first site that comes free\./
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/holds the first site/)).toBeNull();
  });
});
