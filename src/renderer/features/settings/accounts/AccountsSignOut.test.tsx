import { act, screen, waitFor, within } from '@testing-library/react';
import { fail, ok } from '@tests/utils/renderer/createMockApi';
import {
  FAKE_NOT_CONNECTED,
  row,
  rows,
  setupAccounts as setup,
} from '@tests/fixtures/renderer/settings-accounts';
import { SIGNED_IN, account, politeAnnouncement } from '@tests/fixtures/renderer/settings';

describe('Settings → Accounts: sign-out, updates, links and deep links', () => {
  it('Sign out confirms first, then calls accounts.signOut("parkstay")', async () => {
    const signedOut = account({ status: 'signed-out', lastSignedInAt: SIGNED_IN.lastSignedInAt });
    const { user, mock } = setup({
      accounts: [SIGNED_IN],
      signOut: () => Promise.resolve(ok(signedOut)),
    });
    const signOut = mock.api.accounts.signOut;
    await rows();

    await user.click(within(row('ParkStay WA')).getByRole('button', { name: 'Sign out' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Sign out of ParkStay?' });
    expect(signOut).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalledWith('parkstay');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(await within(row('ParkStay WA')).findByText('Signed out')).toBeInTheDocument();
    expect(politeAnnouncement()).toBe('Signed out of ParkStay');
  });

  it('ACCOUNT_BUSY: the refusal stays in the dialog and the status is kept', async () => {
    const busy =
      'A snipe or hold on ParkStay is in progress. Signing out now would lose it; try again once it has finished.';
    const { user } = setup({
      accounts: [SIGNED_IN],
      signOut: () => Promise.resolve(fail(busy, 'ACCOUNT_BUSY')),
    });
    await rows();

    await user.click(within(row('ParkStay WA')).getByRole('button', { name: 'Sign out' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Sign out of ParkStay?' });
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(busy);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(
      within(row('ParkStay WA')).getByText('Signed in as ann@example.com')
    ).toBeInTheDocument();
  });

  it('account:updated updates the row without a reload', async () => {
    const { mock } = setup();
    await rows();
    expect(within(row('ParkStay WA')).getByText('Not connected')).toBeInTheDocument();

    // Signed in elsewhere (a pasted link's window): main stores it and says so
    jest.mocked(mock.api.accounts.list).mockResolvedValue(ok([SIGNED_IN, FAKE_NOT_CONNECTED]));
    mock.emit('account:updated', SIGNED_IN);

    expect(
      await within(row('ParkStay WA')).findByText('Signed in as ann@example.com')
    ).toBeInTheDocument();
  });

  it('a pasted sign-in link opens through accounts.openSignInLink; a refused one shows on the field', async () => {
    const openSignInLink = jest
      .fn()
      .mockResolvedValueOnce(fail('That link is not a ParkStay sign-in link', 'VALIDATION'))
      .mockResolvedValueOnce(ok(undefined));
    const { user } = setup({ openSignInLink });
    await rows();
    const parkstay = row('ParkStay WA');

    await user.click(within(parkstay).getByRole('button', { name: 'Have a sign-in link?' }));
    const field = within(parkstay).getByRole('textbox', { name: 'Sign-in link' });
    await user.type(field, 'http://example.com');
    await user.click(within(parkstay).getByRole('button', { name: 'Open link' }));
    expect(field).toHaveAccessibleDescription('Paste the whole link, starting with https://');
    expect(openSignInLink).not.toHaveBeenCalled();

    await user.clear(field);
    await user.type(field, 'https://example.com/login');
    await user.click(within(parkstay).getByRole('button', { name: 'Open link' }));
    await waitFor(() =>
      expect(field).toHaveAccessibleDescription('That link is not a ParkStay sign-in link')
    );
    expect(openSignInLink).toHaveBeenCalledWith('parkstay', 'https://example.com/login');

    await user.click(within(parkstay).getByRole('button', { name: 'Open link' }));
    await waitFor(() => expect(field).toHaveValue(''));
    expect(politeAnnouncement()).toBe('Sign-in link opened');
  });

  it("?provider=parkstay focuses the ParkStay row's action button", async () => {
    setup({ route: '/settings/accounts?provider=parkstay' });
    await rows();

    const connect = within(row('ParkStay WA')).getByRole('button', { name: 'Connect' });
    await waitFor(() => expect(connect).toHaveFocus());
    // And keeps it: the page heading does not take it back
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(connect).toHaveFocus();
  });

  it('?provider=<id> for a provider without accounts focuses its name', async () => {
    setup({ route: '/settings/accounts?provider=openstay' });
    await rows();

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 3, name: 'Open Stay' })).toHaveFocus()
    );
  });
});
