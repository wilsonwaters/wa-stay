/**
 * Settings → Accounts, a `credentials` account (R15): the row before anything is saved, and the
 * "{shortName} account" form: focus, labels and help, the statements and the disabled Save,
 * errors on their field or in a notice, a pending save, and no typed value left behind.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import { fail, ok } from '@tests/utils/renderer/createMockApi';
import {
  MADE_UP_NUMBER,
  OWN_STATEMENT,
  STAY_STATEMENT,
  credentialsDialog,
  deferred,
  row,
  rows,
  setupCredentials,
  tickStatements,
} from '@tests/fixtures/renderer/settings-accounts';
import { KEY_SAVED, politeAnnouncement } from '@tests/fixtures/renderer/settings';

describe('Settings → Accounts: saved details (credentials): the form', () => {
  it('a row with nothing saved reads "Not added", with "Add member number" and no sign-in link', async () => {
    setupCredentials();
    await rows();

    const keystay = row('Key Stay');
    expect(within(keystay).getByText('Not added')).toBeInTheDocument();
    expect(
      within(keystay).getByRole('button', { name: 'Add member number' })
    ).toHaveAccessibleDescription('Not added');
    expect(within(keystay).queryByRole('button', { name: /connect|sign/i })).toBeNull();
    expect(within(keystay).queryByText('Have a sign-in link?')).toBeNull();
  });

  it('Add opens "KeyStay account": focus on the field, its label and help, masked; Save disabled and explained until every statement is ticked', async () => {
    const { user } = setupCredentials();
    await rows();

    await user.click(within(row('Key Stay')).getByRole('button', { name: 'Add member number' }));

    const field = within(credentialsDialog()).getByLabelText('Member number');
    expect(field).toHaveFocus();
    expect(field).toHaveAccessibleDescription('The 13 digits on your card.');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toHaveAttribute('spellcheck', 'false');
    expect(
      within(credentialsDialog()).getByRole('checkbox', { name: OWN_STATEMENT })
    ).not.toBeChecked();
    expect(
      within(credentialsDialog()).getByRole('checkbox', { name: STAY_STATEMENT })
    ).not.toBeChecked();
    const save = within(credentialsDialog()).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription('Tick each statement to save.');

    await user.click(within(credentialsDialog()).getByRole('checkbox', { name: OWN_STATEMENT }));
    expect(save).toBeDisabled();
    await user.click(within(credentialsDialog()).getByRole('checkbox', { name: STAY_STATEMENT }));
    expect(save).toBeEnabled();
    expect(save).not.toHaveAccessibleDescription();
    expect(within(credentialsDialog()).queryByText('Tick each statement to save.')).toBeNull();
  });

  it('Save sends the values and the statements; the dialog closes, "Member number saved" is announced, focus goes to Replace, and the value is nowhere in the DOM or the query cache', async () => {
    const saveCredentials = jest.fn(() => Promise.resolve(ok(KEY_SAVED)));
    const { user, mock, queryClient } = setupCredentials({ saveCredentials });
    await rows();

    await user.click(within(row('Key Stay')).getByRole('button', { name: 'Add member number' }));
    await user.type(
      within(credentialsDialog()).getByLabelText('Member number'),
      ` ${MADE_UP_NUMBER}`
    );
    await tickStatements(user);
    await user.click(within(credentialsDialog()).getByRole('button', { name: 'Save' }));

    expect(mock.api.accounts.saveCredentials).toHaveBeenCalledWith(
      'keystay',
      { memberNumber: ` ${MADE_UP_NUMBER}` },
      ['own', 'stay']
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const keystay = row('Key Stay');
    expect(within(keystay).getByText('Member number saved')).toBeInTheDocument();
    const replace = within(keystay).getByRole('button', { name: 'Replace' });
    await waitFor(() => expect(replace).toHaveFocus());
    expect(within(keystay).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(within(keystay).getByRole('button', { name: 'Copy member number' })).toBeInTheDocument();
    expect(politeAnnouncement()).toBe('Member number saved');

    expect(document.body.innerHTML).not.toContain(MADE_UP_NUMBER);
    const cached = JSON.stringify([
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state),
      queryClient
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state),
    ]);
    expect(cached).not.toContain(MADE_UP_NUMBER);
  });

  it('Cancel and Escape close it with focus back on the opener; nothing is sent, and it opens empty again', async () => {
    const { user, mock } = setupCredentials();
    await rows();
    const add = within(row('Key Stay')).getByRole('button', { name: 'Add member number' });

    await user.click(add);
    await user.type(within(credentialsDialog()).getByLabelText('Member number'), MADE_UP_NUMBER);
    await user.click(within(credentialsDialog()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(add).toHaveFocus();
    expect(document.body.innerHTML).not.toContain(MADE_UP_NUMBER);

    await user.click(add);
    expect(within(credentialsDialog()).getByLabelText('Member number')).toHaveValue('');
    expect(
      within(credentialsDialog()).getByRole('checkbox', { name: OWN_STATEMENT })
    ).not.toBeChecked();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(add).toHaveFocus();
    expect(mock.api.accounts.saveCredentials).not.toHaveBeenCalled();
  });

  it('an empty field is an alert linked to it; nothing is sent', async () => {
    const { user, mock } = setupCredentials();
    await rows();

    await user.click(within(row('Key Stay')).getByRole('button', { name: 'Add member number' }));
    await tickStatements(user);
    await user.click(within(credentialsDialog()).getByRole('button', { name: 'Save' }));

    const field = within(credentialsDialog()).getByLabelText('Member number');
    expect(within(credentialsDialog()).getByRole('alert')).toHaveTextContent(
      'Enter your member number.'
    );
    expect(field).toHaveAccessibleDescription(
      'The 13 digits on your card. Enter your member number.'
    );
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(mock.api.accounts.saveCredentials).not.toHaveBeenCalled();
  });

  it("main's refusal of the field shows on it and keeps what was typed; one without a field shows as a notice", async () => {
    const saveCredentials = jest
      .fn()
      .mockResolvedValueOnce({
        success: false,
        code: 'VALIDATION',
        error: "KeyStay didn't accept these details",
        issues: ['values.memberNumber'],
      })
      .mockResolvedValueOnce(fail("Couldn't check these details. Try again.", 'PROVIDER_ERROR'));
    const { user } = setupCredentials({ saveCredentials });
    await rows();

    await user.click(within(row('Key Stay')).getByRole('button', { name: 'Add member number' }));
    await user.type(within(credentialsDialog()).getByLabelText('Member number'), '012345678');
    await tickStatements(user);
    await user.click(within(credentialsDialog()).getByRole('button', { name: 'Save' }));

    const field = within(credentialsDialog()).getByLabelText('Member number');
    expect(await within(credentialsDialog()).findByRole('alert')).toHaveTextContent(
      "KeyStay didn't accept these details"
    );
    expect(field).toHaveAccessibleDescription(/KeyStay didn't accept these details/);
    expect(field).toHaveValue('012345678');

    await user.click(within(credentialsDialog()).getByRole('button', { name: 'Save' }));
    expect(
      await within(credentialsDialog()).findByText("Couldn't check these details. Try again.")
    ).toBeInTheDocument();
    expect(within(credentialsDialog()).getByRole('alert')).toHaveTextContent(
      "Couldn't check these details. Try again."
    );
    expect(field).not.toHaveAttribute('aria-invalid');
  });

  it('while a save is pending, Save shows it and the dialog stays open', async () => {
    const pending = deferred<unknown>();
    const { user } = setupCredentials({ saveCredentials: () => pending.promise });
    await rows();

    await user.click(within(row('Key Stay')).getByRole('button', { name: 'Add member number' }));
    await user.type(within(credentialsDialog()).getByLabelText('Member number'), MADE_UP_NUMBER);
    await tickStatements(user);
    await user.click(within(credentialsDialog()).getByRole('button', { name: 'Save' }));

    const save = within(credentialsDialog()).getByRole('button', { name: 'Save' });
    expect(save).toHaveAttribute('aria-busy', 'true');
    expect(within(credentialsDialog()).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(credentialsDialog()).toBeInTheDocument();

    await act(async () => pending.resolve(ok(KEY_SAVED)));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
