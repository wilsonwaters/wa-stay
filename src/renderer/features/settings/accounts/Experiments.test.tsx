import { screen, waitFor, within } from '@testing-library/react';
import { fail, ok } from '@tests/utils/renderer/createMockApi';
import {
  NOT_CONNECTED,
  row,
  rows,
  setupAccounts,
} from '@tests/fixtures/renderer/settings-accounts';
import {
  AUTO_CART,
  CARTSTAY,
  PARKSTAY,
  politeAnnouncement,
} from '@tests/fixtures/renderer/settings';
import type { ProviderExperimentState } from '../../../api';

const OFF: ProviderExperimentState = { id: 'autoCart', enabled: false, active: false };
const ON: ProviderExperimentState = { id: 'autoCart', enabled: true, active: true };
const BUSY = 'A stay is held on CartStay. Pay for it or let it go first.';
const DIALOG = 'Turn on Hold a stay in the cart?';

/** Settings → Accounts with ParkStay and CartStay, whose holds sit behind `autoCart`. */
function setup(
  state: ProviderExperimentState,
  setExperiment: jest.Mock = jest.fn((_id: string, _experiment: string, enabled: boolean) =>
    Promise.resolve(ok([{ ...state, enabled }]))
  )
) {
  const experiments = jest.fn().mockResolvedValue(ok([state]));
  const rendered = setupAccounts({
    providers: [PARKSTAY, CARTSTAY],
    accounts: [NOT_CONNECTED],
    experiments,
    setExperiment,
  });
  return { ...rendered, experiments, setExperiment };
}

const cartSwitch = () =>
  within(row('Cart Stay')).findByRole('switch', { name: 'Hold a stay in the cart' });
/** The polite live region as it is: one announcement has no trailing no-break space. */
const rawAnnouncement = () =>
  document.querySelector('[aria-live="polite"][aria-atomic="true"]')?.textContent ?? '';

describe('Settings → Accounts: Experimental switches (R17)', () => {
  it("ParkStay's row has no Experimental group, and nothing asks for ParkStay's experiments", async () => {
    const { experiments } = setup(OFF);
    await rows();
    await cartSwitch();

    expect(
      within(row('ParkStay WA')).queryByRole('heading', { name: 'Experimental' })
    ).not.toBeInTheDocument();
    expect(within(row('ParkStay WA')).queryByRole('switch')).not.toBeInTheDocument();
    expect(experiments.mock.calls).toEqual([['cartstay']]);
  });

  it('with no stored choice the switch is off; the group shows to everyone, with its label, description and the restart note (RS1)', async () => {
    setup(OFF);
    await rows();
    const cart = row('Cart Stay');
    const toggle = await cartSwitch();

    expect(within(cart).getByRole('heading', { level: 4, name: 'Experimental' })).toBeVisible();
    expect(within(cart).getByRole('region', { name: 'Experimental' })).toHaveTextContent(
      'Takes effect when WA Stay restarts.'
    );
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAccessibleDescription(AUTO_CART.description);
    // Nothing is pending
    expect(within(cart).queryByText(/^Turns (on|off) when WA Stay restarts\.$/)).toBeNull();
  });

  it('on → dialog → "Turn on": setExperiment is called, the pending line shows and is announced once, focus returns to the switch', async () => {
    const { user, setExperiment } = setup(OFF);
    await rows();
    const toggle = await cartSwitch();
    await waitFor(() => expect(toggle).toBeEnabled());

    await user.click(toggle);
    const dialog = await screen.findByRole('alertdialog', { name: DIALOG });
    expect(dialog).toHaveTextContent(AUTO_CART.description);
    expect(dialog).toHaveTextContent(AUTO_CART.warning);
    expect(dialog).toHaveTextContent('Takes effect when WA Stay restarts.');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(setExperiment).not.toHaveBeenCalled();
    expect(toggle).not.toBeChecked();

    await user.click(within(dialog).getByRole('button', { name: 'Turn on' }));

    expect(setExperiment).toHaveBeenCalledWith('cartstay', 'autoCart', true);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(toggle).toBeChecked();
    expect(within(row('Cart Stay')).getByText('Turns on when WA Stay restarts.')).toBeVisible();
    expect(toggle).toHaveAccessibleDescription(
      `Turns on when WA Stay restarts. ${AUTO_CART.description}`
    );
    expect(rawAnnouncement()).toBe('Turns on when WA Stay restarts.');
    expect(politeAnnouncement()).toBe('Turns on when WA Stay restarts.');
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it('Cancel, or Escape, leaves the switch off and makes no call; focus returns to the switch', async () => {
    const { user, setExperiment } = setup(OFF);
    await rows();
    const toggle = await cartSwitch();
    await waitFor(() => expect(toggle).toBeEnabled());

    await user.click(toggle);
    const dialog = await screen.findByRole('alertdialog', { name: DIALOG });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(toggle).not.toBeChecked();
    await waitFor(() => expect(toggle).toHaveFocus());

    await user.keyboard(' ');
    await screen.findByRole('alertdialog', { name: DIALOG });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(toggle).not.toBeChecked();
    await waitFor(() => expect(toggle).toHaveFocus());

    expect(setExperiment).not.toHaveBeenCalled();
    expect(rawAnnouncement()).toBe('');
  });

  it('a refused turn-on stays in the dialog with the reason', async () => {
    const { user } = setup(
      OFF,
      jest.fn().mockResolvedValue(fail('CartStay has no experiment autoCart', 'NOT_FOUND'))
    );
    await rows();
    const toggle = await cartSwitch();
    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);
    const dialog = await screen.findByRole('alertdialog', { name: DIALOG });
    await user.click(within(dialog).getByRole('button', { name: 'Turn on' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'CartStay has no experiment autoCart'
    );
    expect(toggle).not.toBeChecked();
  });

  it('turning off needs no confirmation; the line says it turns off at the restart', async () => {
    const { user, setExperiment } = setup(ON);
    await rows();
    const toggle = await cartSwitch();
    await waitFor(() => expect(toggle).toBeChecked());

    await user.click(toggle);

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(setExperiment).toHaveBeenCalledWith('cartstay', 'autoCart', false);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(within(row('Cart Stay')).getByText('Turns off when WA Stay restarts.')).toBeVisible();
    expect(rawAnnouncement()).toBe('Turns off when WA Stay restarts.');
  });

  it('a refused turn-off shows the reason in an alert under the switch, which stays on', async () => {
    const { user, setExperiment } = setup(
      ON,
      jest.fn().mockResolvedValue(fail(BUSY, 'ACCOUNT_BUSY'))
    );
    await rows();
    const toggle = await cartSwitch();
    await waitFor(() => expect(toggle).toBeChecked());

    await user.click(toggle);

    const alert = await within(row('Cart Stay')).findByRole('alert');
    expect(alert).toHaveTextContent(BUSY);
    expect(setExperiment).toHaveBeenCalledWith('cartstay', 'autoCart', false);
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription(`${BUSY} ${AUTO_CART.description}`);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it.each<[string, ProviderExperimentState, string]>([
    ['waiting to turn on', { ...OFF, enabled: true }, 'Turns on when WA Stay restarts.'],
    ['waiting to turn off', { ...ON, enabled: false }, 'Turns off when WA Stay restarts.'],
    [
      'failed to turn on',
      { ...OFF, enabled: true, failed: true },
      "Couldn't turn on. See the logs, or turn it off.",
    ],
  ])(
    'a stored choice %s shows its line after a reload, without announcing it',
    async (_label, state, line) => {
      setup(state);
      await rows();
      const toggle = await cartSwitch();

      expect(await within(row('Cart Stay')).findByText(line)).toBeVisible();
      expect(toggle).toHaveAccessibleDescription(`${line} ${AUTO_CART.description}`);
      expect(toggle).toHaveProperty('checked', state.enabled);
      expect(rawAnnouncement()).toBe('');
    }
  );

  it("the experiments couldn't be loaded: says so, with Try again", async () => {
    const experiments = jest
      .fn()
      // Once, and once more when the query retries
      .mockResolvedValueOnce(fail('The database is busy'))
      .mockResolvedValueOnce(fail('The database is busy'))
      .mockResolvedValue(ok([OFF]));
    const { user } = setupAccounts({
      providers: [PARKSTAY, CARTSTAY],
      accounts: [NOT_CONNECTED],
      experiments,
      setExperiment: jest.fn(),
    });
    await rows();

    const alert = await within(row('Cart Stay')).findByRole('alert', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent("Experimental settings couldn't be loaded");
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await cartSwitch()).not.toBeChecked();
  });
});
