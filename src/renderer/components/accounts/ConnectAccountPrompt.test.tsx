import { act, screen, waitFor } from '@testing-library/react';
import type { ProviderAccount } from '../../../shared/types/provider.types';
import { ACCOUNT_REQUIRED_MANIFEST } from '@tests/fixtures/renderer/snipes';
import { createMockApi, fail, ok, PARKSTAY_MANIFEST } from '@tests/utils/renderer/createMockApi';
import { FAKE_MANIFEST } from '@tests/utils/renderer/manifests';
import { politeAnnouncement, renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { ConnectAccountPrompt, NOT_CONNECTED } from './ConnectAccountPrompt';

const account = (status: ProviderAccount['status'], providerId = 'fakestay'): ProviderAccount => ({
  providerId,
  requirement: providerId === 'parkstay' ? 'optional' : 'required-for-holds',
  status,
});

/** A sign-in whose window stays open until the test closes it. */
function pendingSignIn() {
  let close: (account: ProviderAccount) => void = () => undefined;
  const signIn = jest.fn(
    () => new Promise((resolve) => (close = (a: ProviderAccount) => resolve(ok(a))))
  );
  return { signIn, close: (a: ProviderAccount) => close(a) };
}

describe('ConnectAccountPrompt', () => {
  it('blocks for a provider whose holds need an account, and signs in with it', async () => {
    const { signIn, close } = pendingSignIn();
    const mock = createMockApi({
      accounts: { list: jest.fn().mockResolvedValue(ok([account('signed-out')])), signIn },
    });
    const { user } = renderWithProviders(
      <ConnectAccountPrompt manifest={ACCOUNT_REQUIRED_MANIFEST} />,
      {
        api: mock,
      }
    );
    const button = await screen.findByRole('button', { name: 'Connect Fake Stay' });
    expect(
      screen.getByText('Fake Stay needs you signed in before it can hold anything for you.')
    ).toBeInTheDocument();

    await user.click(button);
    expect(signIn).toHaveBeenCalledWith('fakestay');
    expect(
      await screen.findByText('Finish signing in in the Fake Stay window.')
    ).toBeInTheDocument();

    // The window closes without signing in: focus back on Connect, the outcome announced.
    act(() => close(account('signed-out')));
    const settings = await screen.findByRole('link', { name: 'Settings → Accounts' });
    expect(settings.closest('p')).toHaveTextContent(NOT_CONNECTED);
    await waitFor(() => expect(button).toHaveFocus());
    expect(politeAnnouncement()).toBe(NOT_CONNECTED);
    expect(settings).toHaveAttribute('href', '#/settings/accounts?provider=fakestay');
  });

  it('goes once account:updated reports signed in, and says so where focus lands', async () => {
    const list = jest.fn().mockResolvedValue(ok([account('signed-out')]));
    const { signIn, close } = pendingSignIn();
    const mock = createMockApi({ accounts: { list, signIn } });
    const { user } = renderWithProviders(
      <ConnectAccountPrompt manifest={ACCOUNT_REQUIRED_MANIFEST} />,
      {
        api: mock,
      }
    );
    await user.click(await screen.findByRole('button', { name: 'Connect Fake Stay' }));
    list.mockResolvedValue(ok([account('signed-in')]));
    act(() => close(account('signed-in')));
    mock.emit('account:updated', account('signed-in'));

    const done = await screen.findByText('Connected to Fake Stay.');
    expect(done).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Connect Fake Stay' })).toBeNull();
    expect(politeAnnouncement()).toBe('Connected to Fake Stay');
  });

  it('disappears when the account is signed in elsewhere', async () => {
    const list = jest.fn().mockResolvedValue(ok([account('signed-out')]));
    const mock = createMockApi({ accounts: { list } });
    renderWithProviders(<ConnectAccountPrompt manifest={ACCOUNT_REQUIRED_MANIFEST} />, {
      api: mock,
    });
    await screen.findByRole('button', { name: 'Connect Fake Stay' });
    list.mockResolvedValue(ok([account('signed-in')]));
    mock.emit('account:updated', account('signed-in'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Connect Fake Stay' })).toBeNull()
    );
    expect(screen.queryByText(/Connected to/)).toBeNull();
  });

  it('only suggests connecting for an optional account (ParkStay), and not at all on a card', async () => {
    const signIn = jest.fn().mockResolvedValue(ok(account('signed-in', 'parkstay')));
    const api = {
      accounts: {
        list: jest.fn().mockResolvedValue(ok([account('signed-out', 'parkstay')])),
        signIn,
      },
    };
    const message = 'Connect ParkStay before the release so checkout is quicker.';
    const { user, unmount } = renderWithProviders(
      <ConnectAccountPrompt manifest={PARKSTAY_MANIFEST} message={message} />,
      { api }
    );
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Connect ParkStay' }));
    expect(signIn).toHaveBeenCalledWith('parkstay');
    unmount();

    renderWithProviders(<ConnectAccountPrompt manifest={PARKSTAY_MANIFEST} when="required" />, {
      api,
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByRole('button', { name: 'Connect ParkStay' })).toBeNull();
  });

  it('treats a status it cannot load, or an unknown one, as signed out, with Retry', async () => {
    const status = jest.fn().mockResolvedValue(ok(account('signed-out')));
    const { user, unmount } = renderWithProviders(
      <ConnectAccountPrompt manifest={ACCOUNT_REQUIRED_MANIFEST} />,
      { api: { accounts: { list: jest.fn().mockResolvedValue(ok([account('unknown')])), status } } }
    );
    expect(await screen.findByRole('button', { name: 'Connect Fake Stay' })).toBeInTheDocument();
    expect(
      await screen.findByText("WA Stay couldn't tell whether you're signed in.")
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(status).toHaveBeenCalledWith('fakestay');
    unmount();

    // accounts.list fails (after its one retry): still offered, with Retry.
    renderWithProviders(<ConnectAccountPrompt manifest={ACCOUNT_REQUIRED_MANIFEST} />, {
      api: { accounts: { list: jest.fn().mockResolvedValue(fail('offline')), status } },
    });
    expect(
      await screen.findByRole('button', { name: 'Retry' }, { timeout: 4000 })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Fake Stay' })).toBeInTheDocument();
  });

  it('shows nothing for a provider without accounts', () => {
    renderWithProviders(<ConnectAccountPrompt manifest={FAKE_MANIFEST} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Connect/)).toBeNull();
  });
});
