/**
 * Settings → Accounts, a `credentials` account with its details saved (R15): Replace, Remove
 * (confirmed first, then `accounts.signOut`) and Copy (main writes the clipboard), each
 * announced, with focus back on the row's first button.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { fail, ok } from '@tests/utils/renderer/createMockApi';
import {
  NOT_CONNECTED,
  credentialsDialog,
  row,
  rows,
  setupCredentials,
  tickStatements,
} from '@tests/fixtures/renderer/settings-accounts';
import {
  KEY_SAVED,
  MEMBER_NUMBER_FIELD,
  keyAccount,
  politeAnnouncement,
} from '@tests/fixtures/renderer/settings';

describe('Settings → Accounts: saved details (credentials): replace, remove and copy', () => {
  it('Replace opens the same form and saves again', async () => {
    const saveCredentials = jest.fn(() => Promise.resolve(ok(KEY_SAVED)));
    const { user, mock } = setupCredentials({
      accounts: [NOT_CONNECTED, KEY_SAVED],
      saveCredentials,
    });
    await rows();

    const replace = within(row('Key Stay')).getByRole('button', { name: 'Replace' });
    expect(replace).toHaveAccessibleDescription('Member number saved');
    await user.click(replace);
    expect(within(credentialsDialog()).getByLabelText('Member number')).toHaveValue('');
    await user.type(within(credentialsDialog()).getByLabelText('Member number'), '012345678');
    await tickStatements(user);
    await user.click(within(credentialsDialog()).getByRole('button', { name: 'Save' }));

    expect(mock.api.accounts.saveCredentials).toHaveBeenCalledWith(
      'keystay',
      { memberNumber: '012345678' },
      ['own', 'stay']
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(replace).toHaveFocus());
    expect(politeAnnouncement()).toBe('Member number saved');
  });

  it('Remove asks first, then calls accounts.signOut; the removal is announced and focus goes to Add', async () => {
    const { user, mock } = setupCredentials({
      accounts: [NOT_CONNECTED, KEY_SAVED],
      signOut: () => Promise.resolve(ok(keyAccount())),
    });
    await rows();

    await user.click(within(row('Key Stay')).getByRole('button', { name: 'Remove' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove your member number?' });
    expect(confirm).toHaveAccessibleDescription(
      'WA Stay forgets it; you can add it again any time.'
    );
    expect(mock.api.accounts.signOut).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));

    expect(mock.api.accounts.signOut).toHaveBeenCalledWith('keystay');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    const add = await within(row('Key Stay')).findByRole('button', { name: 'Add member number' });
    await waitFor(() => expect(add).toHaveFocus());
    expect(within(row('Key Stay')).getByText('Not added')).toBeInTheDocument();
    expect(politeAnnouncement()).toBe('Member number removed');
  });

  it('Copy asks main to copy (the renderer never has the value) and announces "Member number copied", focus kept; a failure shows a toast', async () => {
    const copyCredential = jest
      .fn()
      .mockResolvedValueOnce(ok(undefined))
      .mockResolvedValueOnce(
        fail("Couldn't read your saved Member number. Add it again.", 'INTERNAL')
      );
    const { user, mock } = setupCredentials({
      accounts: [NOT_CONNECTED, KEY_SAVED],
      copyCredential,
    });
    await rows();

    const copy = within(row('Key Stay')).getByRole('button', { name: 'Copy member number' });
    expect(copy).toHaveAccessibleDescription('Member number saved');
    await user.click(copy);
    expect(mock.api.accounts.copyCredential).toHaveBeenCalledWith('keystay', 'memberNumber');
    await waitFor(() => expect(politeAnnouncement()).toBe('Member number copied'));
    expect(copy).toHaveFocus();

    await user.click(copy);
    const toasts = screen.getByRole('region', { name: 'Notifications' });
    expect(
      await within(toasts).findByText("Couldn't read your saved Member number. Add it again.")
    ).toBeInTheDocument();
  });

  it('only saved, copyable fields get a Copy button', async () => {
    setupCredentials({
      accounts: [
        NOT_CONNECTED,
        keyAccount({
          status: 'signed-in',
          fields: [MEMBER_NUMBER_FIELD, { key: 'password', label: 'Password', secret: true }],
          savedFields: ['memberNumber', 'password'],
        }),
      ],
    });
    await rows();

    const keystay = row('Key Stay');
    expect(within(keystay).getByText('Details saved')).toBeInTheDocument();
    expect(within(keystay).getAllByRole('button', { name: /^Copy/ })).toHaveLength(1);
    expect(within(keystay).getByRole('button', { name: 'Copy member number' })).toBeInTheDocument();
  });
});
