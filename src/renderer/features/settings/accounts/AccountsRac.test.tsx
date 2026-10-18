/**
 * Settings → Accounts, RAC's row (R16): RAC's account is its member number, optional and saved
 * in the app (R15's form with RAC's descriptor): "Not added" with "Add RAC member number"; the
 * "RAC account" form with a masked field whose label and help are linked, three labelled
 * statements and Save disabled until all are ticked; RAC's refusal on the field; once saved,
 * "RAC member number saved" with Replace, Remove and "Copy RAC member number" (announced,
 * focus kept); Remove asks first. Made-up numbers only, never in the page.
 *
 * Auto-cart (R19): RAC's row has an "Experimental" group with "Put stays in my RAC cart
 * automatically", off, which asks first with RAC's warning; once on (after a restart, holds on),
 * the row suggests adding the member number before a release, and says "Optional." once saved.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { fail, ok } from '@tests/utils/renderer/createMockApi';
import type { ProviderExperimentState } from '../../../../shared/contracts';
import { RAC_AUTO_CART_MANIFEST, RAC_MANIFEST } from '@tests/utils/renderer/manifests';
import {
  NOT_CONNECTED,
  row,
  rows,
  setupAccounts,
} from '@tests/fixtures/renderer/settings-accounts';
import {
  PARKSTAY,
  RAC_SAVED,
  politeAnnouncement,
  racAccount,
} from '@tests/fixtures/renderer/settings';

const RAC_ROW = 'RAC Parks & Resorts';
const STATEMENTS = [
  'This is my own RAC member number',
  'I will stay at the park myself',
  'I will book in the name on my RAC card',
];
const HELP =
  "On your RAC card or in myRAC. Kept encrypted on this computer and never sent. You type it at RAC's checkout.";
/** Made up: a leading zero, as a member number may have. */
const NUMBER = '012345678';

const dialog = () => screen.getByRole('dialog', { name: 'RAC account' });

const CART_OFF: ProviderExperimentState = { id: 'autoCart', enabled: false, active: false };
const CART_ON: ProviderExperimentState = { id: 'autoCart', enabled: true, active: true };
const AUTO_CART = RAC_MANIFEST.experiments![0];

function setup(options: Parameters<typeof setupAccounts>[0] = {}) {
  return setupAccounts({
    providers: [PARKSTAY, RAC_MANIFEST],
    accounts: [NOT_CONNECTED, racAccount()],
    // RAC's auto-cart experiment (R19), off
    experiments: jest.fn().mockResolvedValue(ok([CART_OFF])),
    ...options,
  });
}

describe("Settings → Accounts: RAC's member number", () => {
  it('reads "Not added", optional, with "Add RAC member number" and no sign-in', async () => {
    setup();
    await rows();
    const rac = row(RAC_ROW);
    expect(within(rac).getByText('Not added')).toBeInTheDocument();
    expect(within(rac).getByText('Optional.')).toBeInTheDocument();
    expect(
      within(rac).getByRole('button', { name: 'Add RAC member number' })
    ).toHaveAccessibleDescription('Not added');
    expect(within(rac).queryByRole('button', { name: /connect|sign/i })).toBeNull();
  });

  it("the form: a masked field with its label and help linked, three labelled statements, Save disabled until all are ticked, and RAC's refusal on the field", async () => {
    const saveCredentials = jest.fn(() =>
      Promise.resolve({
        success: false,
        code: 'VALIDATION',
        error: "That doesn't look like an RAC member number",
        issues: ['values.memberNumber'],
      })
    );
    const { user } = setup({ saveCredentials });
    await rows();
    await user.click(within(row(RAC_ROW)).getByRole('button', { name: 'Add RAC member number' }));

    const field = within(dialog()).getByLabelText('RAC member number');
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAccessibleDescription(HELP);
    const save = within(dialog()).getByRole('button', { name: 'Save' });
    for (const statement of STATEMENTS) {
      expect(save).toBeDisabled();
      const box = within(dialog()).getByRole('checkbox', { name: statement });
      expect(box).not.toBeChecked();
      await user.click(box);
    }
    expect(save).toBeEnabled();

    await user.type(field, '12AB34');
    await user.click(save);
    await waitFor(() =>
      expect(field).toHaveAccessibleDescription(
        expect.stringContaining("That doesn't look like an RAC member number")
      )
    );
    expect(field).toHaveFocus();
  });

  it('once saved: "RAC member number saved", Replace, Remove and Copy, with the number nowhere in the page', async () => {
    const saveCredentials = jest.fn(() => Promise.resolve(ok(RAC_SAVED)));
    const copyCredential = jest.fn().mockResolvedValue(ok(undefined));
    const { user, mock } = setup({ saveCredentials, copyCredential });
    await rows();
    await user.click(within(row(RAC_ROW)).getByRole('button', { name: 'Add RAC member number' }));
    await user.type(within(dialog()).getByLabelText('RAC member number'), NUMBER);
    for (const statement of STATEMENTS) {
      await user.click(within(dialog()).getByRole('checkbox', { name: statement }));
    }
    await user.click(within(dialog()).getByRole('button', { name: 'Save' }));

    expect(mock.api.accounts.saveCredentials).toHaveBeenCalledWith(
      'rac',
      { memberNumber: NUMBER },
      ['ownNumber', 'willStay', 'nameOnCard']
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const rac = row(RAC_ROW);
    expect(within(rac).getByText('RAC member number saved')).toBeInTheDocument();
    expect(politeAnnouncement()).toBe('RAC member number saved');
    expect(within(rac).getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    expect(within(rac).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(NUMBER);

    const copy = within(rac).getByRole('button', { name: 'Copy RAC member number' });
    await user.click(copy);
    expect(copyCredential).toHaveBeenCalledWith('rac', 'memberNumber');
    await waitFor(() => expect(politeAnnouncement()).toBe('RAC member number copied'));
    expect(copy).toHaveFocus();
  });

  it('Remove asks first, in words for one detail, then the copy button goes', async () => {
    const signOut = jest.fn(() => Promise.resolve(ok(racAccount())));
    const { user } = setup({ accounts: [NOT_CONNECTED, RAC_SAVED], signOut });
    await rows();
    await user.click(within(row(RAC_ROW)).getByRole('button', { name: 'Remove' }));
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Remove your RAC member number?',
    });
    expect(confirm).toHaveAccessibleDescription(
      'WA Stay forgets it; you can add it again any time.'
    );
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(
      await within(row(RAC_ROW)).findByRole('button', { name: 'Add RAC member number' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy RAC member number' })).toBeNull();
  });

  it('a copy that fails says why, with no value', async () => {
    const copyCredential = jest
      .fn()
      .mockResolvedValue(
        fail("Couldn't read your saved RAC member number. Add it again.", 'INTERNAL')
      );
    const { user } = setup({ accounts: [NOT_CONNECTED, RAC_SAVED], copyCredential });
    await rows();
    await user.click(within(row(RAC_ROW)).getByRole('button', { name: 'Copy RAC member number' }));
    const toasts = screen.getByRole('region', { name: 'Notifications' });
    expect(
      await within(toasts).findByText("Couldn't read your saved RAC member number. Add it again.")
    ).toBeInTheDocument();
  });
});

describe("Settings → Accounts: RAC's auto-cart (R19)", () => {
  const cartSwitch = () =>
    within(row(RAC_ROW)).findByRole('switch', { name: 'Put stays in my RAC cart automatically' });

  it('shows the Experimental switch to everyone, off, with its description', async () => {
    setup();
    await rows();
    const toggle = await cartSwitch();
    expect(
      within(row(RAC_ROW)).getByRole('heading', { level: 4, name: 'Experimental' })
    ).toBeVisible();
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAccessibleDescription(AUTO_CART.description);
  });

  it('turning it on asks first, with the warning: a cart is not a booking', async () => {
    const setExperiment = jest.fn().mockResolvedValue(ok([{ ...CART_OFF, enabled: true }]));
    const { user } = setup({ setExperiment });
    await rows();
    const toggle = await cartSwitch();
    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Turn on Put stays in my RAC cart automatically?',
    });
    expect(dialog).toHaveTextContent(
      'Experimental: not yet checked with a real booking. A cart is not a booking: only a paid booking secures your stay.'
    );
    expect(dialog).toHaveTextContent('Takes effect when WA Stay restarts.');
    await user.click(within(dialog).getByRole('button', { name: 'Turn on' }));
    expect(setExperiment).toHaveBeenCalledWith('rac', 'autoCart', true);
    expect(await within(row(RAC_ROW)).findByText('Turns on when WA Stay restarts.')).toBeVisible();
  });

  it('once on (holds on), the row suggests adding the member number before a release; saved, "Optional."', async () => {
    const experiments = jest.fn().mockResolvedValue(ok([CART_ON]));
    setup({ providers: [PARKSTAY, RAC_AUTO_CART_MANIFEST], experiments });
    await rows();
    expect(
      within(row(RAC_ROW)).getByText(
        'Optional. Add your RAC member number before a release if you have one. Holds work without it.'
      )
    ).toBeInTheDocument();
    expect(await cartSwitch()).toBeChecked();
  });

  it('once on, with the member number saved: "Optional." and no suggestion', async () => {
    const experiments = jest.fn().mockResolvedValue(ok([CART_ON]));
    setup({
      providers: [PARKSTAY, RAC_AUTO_CART_MANIFEST],
      accounts: [NOT_CONNECTED, RAC_SAVED],
      experiments,
    });
    await rows();
    expect(within(row(RAC_ROW)).getByText('Optional.')).toBeInTheDocument();
    expect(within(row(RAC_ROW)).queryByText(/before a release/)).toBeNull();
  });
});
