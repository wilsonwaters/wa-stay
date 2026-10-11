import { act, waitFor, within } from '@testing-library/react';
import { fail, ok } from '@tests/utils/renderer/createMockApi';
import {
  FAKE_NOT_CONNECTED,
  NOT_CONNECTED,
  deferred,
  row,
  rows,
  setupAccounts as setup,
} from '@tests/fixtures/renderer/settings-accounts';
import {
  HOLDSTAY,
  OPENSTAY,
  PARKSTAY,
  SIGNED_IN,
  WATCHSTAY,
  account,
  LAST_SIGN_IN,
  politeAnnouncement,
} from '@tests/fixtures/renderer/settings';

describe('Settings → Accounts: rows and sign-in', () => {
  it('shows one row per registered provider: badge, status, label and what it is needed for', async () => {
    setup({ accounts: [SIGNED_IN, FAKE_NOT_CONNECTED] });

    expect(await rows()).toHaveLength(3);

    const parkstay = row('ParkStay WA');
    expect(within(parkstay).getByText('Signed in as ann@example.com')).toBeInTheDocument();
    expect(within(parkstay).getByText('last signed in Sat 3 Oct 2026')).toBeInTheDocument();
    // Signed in: no suggestion to connect, only what it gives
    expect(
      within(parkstay).getByText("Optional. Checkout is quicker while you're signed in.")
    ).toBeInTheDocument();
    expect(within(parkstay).queryByText(/Connect ParkStay before a release/)).toBeNull();
    expect(within(parkstay).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();

    const fake = row('Fake Stay');
    expect(within(fake).getByText('Not connected')).toBeInTheDocument();
    expect(
      within(fake).getByText(
        'Needed for holds (Site Sniper and automatic holds). Also used to import your bookings.'
      )
    ).toBeInTheDocument();
    expect(
      within(fake).getByText("FakeStay holds can't be placed until you connect.")
    ).toBeInTheDocument();
    expect(within(fake).getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('a provider with no accounts reads "No account needed" and has no button', async () => {
    setup();
    await rows();

    const open = row('Open Stay');
    expect(within(open).getByText('No account needed')).toBeInTheDocument();
    expect(within(open).queryByRole('button', { name: /connect|sign/i })).toBeNull();
    expect(within(open).queryByText('Have a sign-in link?')).toBeNull();
  });

  it('checks each account once on arrival (read-only), never a provider without accounts', async () => {
    const { mock } = setup();
    await rows();

    await waitFor(() => expect(mock.api.accounts.status).toHaveBeenCalledTimes(2));
    expect(mock.api.accounts.status).toHaveBeenCalledWith('parkstay');
    expect(mock.api.accounts.status).toHaveBeenCalledWith('fakestay');
  });

  it('Connect calls accounts.signIn("parkstay") and shows "Waiting for sign-in…" until it resolves', async () => {
    const pending = deferred<unknown>();
    const { user, mock } = setup({ signIn: () => pending.promise });
    await rows();

    await user.click(within(row('ParkStay WA')).getByRole('button', { name: 'Connect' }));

    expect(mock.api.accounts.signIn).toHaveBeenCalledWith('parkstay');
    const waiting = within(row('ParkStay WA')).getByRole('button', {
      name: 'Waiting for sign-in…',
    });
    expect(waiting).toHaveAttribute('aria-busy', 'true');
    // "Connect" still holds its place (hidden), so the button keeps the wider label's width
    expect(within(waiting).getByText('Connect')).toHaveAttribute('aria-hidden', 'true');
    expect(within(waiting).getByText('Waiting for sign-in…')).not.toHaveAttribute('aria-hidden');
    // One sign-in at a time
    expect(within(row('Fake Stay')).getByRole('button', { name: 'Connect' })).toBeDisabled();

    await act(async () => pending.resolve(ok(SIGNED_IN)));

    const signOut = await within(row('ParkStay WA')).findByRole('button', { name: 'Sign out' });
    expect(
      within(row('ParkStay WA')).getByText('Signed in as ann@example.com')
    ).toBeInTheDocument();
    await waitFor(() => expect(signOut).toHaveFocus());
    expect(politeAnnouncement()).toBe('Signed in to ParkStay as ann@example.com');
    expect(within(row('Fake Stay')).getByRole('button', { name: 'Connect' })).toBeEnabled();
  });

  it('a window closed without signing in reads "Sign-in wasn\'t completed"; focus returns to Connect', async () => {
    const { user } = setup({ signIn: () => Promise.resolve(ok(NOT_CONNECTED)) });
    await rows();

    await user.click(within(row('ParkStay WA')).getByRole('button', { name: 'Connect' }));

    expect(
      await within(row('ParkStay WA')).findByText("Sign-in wasn't completed.")
    ).toBeInTheDocument();
    expect(within(row('ParkStay WA')).getByText('Not connected')).toBeInTheDocument();
    const connect = within(row('ParkStay WA')).getByRole('button', { name: 'Connect' });
    await waitFor(() => expect(connect).toHaveFocus());
    expect(politeAnnouncement()).toBe("Sign-in to ParkStay wasn't completed");
  });

  it('a sign-in that fails shows the error inline, with Retry', async () => {
    const signIn = jest
      .fn()
      .mockResolvedValueOnce(fail("ParkStay's sign-in page couldn't be loaded.", 'PROVIDER_ERROR'))
      .mockResolvedValueOnce(ok(SIGNED_IN));
    const { user } = setup({ signIn });
    await rows();

    await user.click(within(row('ParkStay WA')).getByRole('button', { name: 'Connect' }));

    expect(
      await within(row('ParkStay WA')).findByText("ParkStay's sign-in page couldn't be loaded.")
    ).toBeInTheDocument();
    await user.click(within(row('ParkStay WA')).getByRole('button', { name: 'Retry' }));
    expect(
      await within(row('ParkStay WA')).findByText('Signed in as ann@example.com')
    ).toBeInTheDocument();
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it('a session signed in before reads "Signed out", with Reconnect', async () => {
    setup({ accounts: [account({ status: 'signed-out', lastSignedInAt: LAST_SIGN_IN })] });
    await rows();

    expect(within(row('ParkStay WA')).getByText('Signed out')).toBeInTheDocument();
    expect(
      within(row('ParkStay WA')).getByRole('button', { name: 'Reconnect' })
    ).toBeInTheDocument();
  });
});

describe('Settings → Accounts: what each row says follows its manifest', () => {
  const setupWording = () =>
    setup({
      providers: [PARKSTAY, HOLDSTAY, WATCHSTAY, OPENSTAY],
      accounts: [
        NOT_CONNECTED,
        account({ providerId: 'holdstay' }),
        account({ providerId: 'watchstay' }),
      ],
    });

  it('ParkStay (Site Sniper, holds, optional account) still suggests connecting before a release', async () => {
    setupWording();
    await rows();

    const parkstay = row('ParkStay WA');
    expect(within(parkstay).getByText('Not connected')).toBeInTheDocument();
    expect(
      within(parkstay).getByText(
        'Optional. Connect ParkStay before a release so checkout is quicker. Holds work without it.'
      )
    ).toBeInTheDocument();
    expect(within(parkstay).getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('a provider with holds but no Site Sniper talks about checkout only: no release, no Site Sniper', async () => {
    setupWording();
    await rows();

    const holdstay = row('Hold Stay');
    expect(
      within(holdstay).getByText(
        'Optional. Connect HoldStay so checkout is quicker. Holds work without it.'
      )
    ).toBeInTheDocument();
    expect(within(holdstay).queryByText(/release/i)).toBeNull();
    expect(within(holdstay).queryByText(/Site Sniper/)).toBeNull();
    expect(within(holdstay).getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('a provider with no holds says only that the account is optional', async () => {
    setupWording();
    await rows();

    const watchstay = row('Watch Stay');
    expect(within(watchstay).getByText('Not connected')).toBeInTheDocument();
    expect(within(watchstay).getByText('Optional.')).toBeInTheDocument();
    expect(within(watchstay).queryByText(/release|checkout|holds|Site Sniper/i)).toBeNull();
    expect(within(watchstay).getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('a provider with no accounts says "No account needed" once, with no button', async () => {
    setupWording();
    await rows();

    const open = row(OPENSTAY.name);
    expect(within(open).getAllByText(/No account needed/)).toHaveLength(1);
    expect(within(open).queryByRole('button')).toBeNull();
  });
});
