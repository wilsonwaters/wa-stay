import { screen, waitFor, within } from '@testing-library/react';
import { fail, ok } from '@tests/utils/renderer/createMockApi';
import {
  NOT_CONNECTED,
  deferred,
  row,
  rows,
  setupAccounts,
} from '@tests/fixtures/renderer/settings-accounts';
import { AUTO_CART, CARTSTAY, PARKSTAY } from '@tests/fixtures/renderer/settings';
import {
  DIALOG,
  OFF,
  ON,
  cartSwitch,
  rawAnnouncement,
  setupExperiments as setup,
} from '@tests/fixtures/renderer/settings-experiments';
import type { ProviderExperimentState } from '../../../api';

describe('Settings → Accounts: Experimental switches, pending and failing states (R17)', () => {
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

  it('the switch is disabled while its change is saved, and keeps focus once it is', async () => {
    const answer = deferred<unknown>();
    const { user, setExperiment } = setup(
      ON,
      jest.fn(() => answer.promise)
    );
    await rows();
    const toggle = await cartSwitch();
    await waitFor(() => expect(toggle).toBeChecked());

    await user.click(toggle);

    expect(setExperiment).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toggle).toBeDisabled());
    answer.resolve(ok([{ ...ON, enabled: false }]));
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it('turning it back on while it is still on (its turn-off waits for the restart) says nothing about a restart', async () => {
    const { user, setExperiment } = setup({ ...ON, enabled: false });
    await rows();
    const toggle = await cartSwitch();
    await waitFor(() => expect(toggle).toBeEnabled());

    await user.click(toggle);
    const dialog = await screen.findByRole('alertdialog', { name: DIALOG });
    expect(dialog).toHaveTextContent(AUTO_CART.warning);
    expect(dialog).not.toHaveTextContent('Takes effect when WA Stay restarts.');
    await user.click(within(dialog).getByRole('button', { name: 'Turn on' }));

    expect(setExperiment).toHaveBeenCalledWith('cartstay', 'autoCart', true);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(
      within(row('Cart Stay')).queryByText(/^Turns (on|off) when WA Stay restarts\.$/)
    ).toBeNull();
    expect(rawAnnouncement()).toBe('');
  });

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
