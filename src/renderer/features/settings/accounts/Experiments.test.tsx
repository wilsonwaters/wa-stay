import { screen, waitFor, within } from '@testing-library/react';
import { fail } from '@tests/utils/renderer/createMockApi';
import { row, rows } from '@tests/fixtures/renderer/settings-accounts';
import { AUTO_CART, politeAnnouncement } from '@tests/fixtures/renderer/settings';
import {
  BUSY,
  DIALOG,
  OFF,
  ON,
  cartSwitch,
  rawAnnouncement,
  setupExperiments as setup,
} from '@tests/fixtures/renderer/settings-experiments';

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
    // Named with the provider: two providers with experiments are two distinct regions
    expect(within(cart).getByRole('region', { name: 'Cart Stay experimental' })).toHaveTextContent(
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
});
