import { screen, waitFor, within } from '@testing-library/react';
import { createMockApi, fail, ok, activeAccess } from '@tests/utils/renderer/createMockApi';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

const card = () => screen.queryByRole('region', { name: /update|Downloading|couldn't update/i });
const progress = { bytesPerSecond: 1, transferred: 1, total: 2 };

function renderCard() {
  const mock = createMockApi({
    updater: {
      downloadUpdate: jest.fn().mockResolvedValue(ok(true)),
      installUpdate: jest.fn().mockResolvedValue(ok(true)),
    },
  });
  const result = renderWithApp({ api: mock });
  return { ...result, mock };
}

describe('UpdateCard', () => {
  it('available: Download and Later; Download starts it and shows a progress bar', async () => {
    const { mock, user } = renderCard();
    expect(card()).toBeNull();

    mock.emit('updater:available', { version: '2.1.0' });
    const available = await screen.findByRole('region', { name: 'Update available' });
    expect(available).toHaveTextContent('WA Stay 2.1.0 is ready to download.');
    expect(within(available).getByRole('button', { name: 'Later' })).toBeInTheDocument();
    expect(within(available).getByRole('button', { name: 'Dismiss update' })).toBeInTheDocument();

    await user.click(within(available).getByRole('button', { name: 'Download' }));
    expect(mock.api.updater.downloadUpdate).toHaveBeenCalledTimes(1);
    const downloading = screen.getByRole('region', { name: 'Downloading WA Stay 2.1.0' });
    const bar = within(downloading).getByRole('progressbar', { name: 'Update download' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    // No way to close it mid-download.
    expect(within(downloading).queryByRole('button')).toBeNull();

    mock.emit('updater:progress', { percent: 42.4, ...progress });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(downloading).toHaveTextContent('42%');
  });

  it('downloaded: Restart now installs; Later sets it aside', async () => {
    const { mock, user } = renderCard();
    mock.emit('updater:downloaded', { version: '2.1.0' });
    const ready = await screen.findByRole('region', { name: 'Update ready' });
    expect(ready).toHaveTextContent(
      'WA Stay 2.1.0 has downloaded. Restart WA Stay to finish updating.'
    );

    await user.click(within(ready).getByRole('button', { name: 'Restart now' }));
    expect(mock.api.updater.installUpdate).toHaveBeenCalledTimes(1);

    await user.click(within(ready).getByRole('button', { name: 'Later' }));
    expect(card()).toBeNull();
  });

  it('error: the message and Dismiss', async () => {
    const { mock, user } = renderCard();
    mock.emit('updater:error', { error: 'Cannot find latest.yml in the release' });
    const error = await screen.findByRole('region', { name: "WA Stay couldn't update" });
    expect(error).toHaveTextContent('Cannot find latest.yml in the release');
    await user.click(within(error).getByRole('button', { name: 'Dismiss' }));
    expect(card()).toBeNull();
  });

  it('after Later, re-shows only for a new state (available → downloaded)', async () => {
    const { mock, user } = renderCard();
    mock.emit('updater:available', { version: '2.1.0' });
    await user.click(await screen.findByRole('button', { name: 'Later' }));
    expect(card()).toBeNull();

    mock.emit('updater:available', { version: '2.1.0' });
    expect(card()).toBeNull();

    mock.emit('updater:downloaded', { version: '2.1.0' });
    expect(await screen.findByRole('region', { name: 'Update ready' })).toBeInTheDocument();
  });

  it('a download error mid-way switches to the error state', async () => {
    const { mock, user } = renderCard();
    mock.emit('updater:available', { version: '2.1.0' });
    await user.click(await screen.findByRole('button', { name: 'Download' }));
    mock.emit('updater:progress', { percent: 30, ...progress });
    mock.emit('updater:error', { error: 'net::ERR_CONNECTION_RESET' });

    const error = screen.getByRole('region', { name: "WA Stay couldn't update" });
    expect(error).toHaveTextContent('net::ERR_CONNECTION_RESET');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('a refused download shows its error in the card', async () => {
    const mock = createMockApi({
      updater: { downloadUpdate: jest.fn().mockResolvedValue(fail('No update to download')) },
    });
    const { user } = renderWithApp({ api: mock });
    mock.emit('updater:available', { version: '2.1.0' });
    await user.click(await screen.findByRole('button', { name: 'Download' }));
    expect(
      await screen.findByRole('region', { name: "WA Stay couldn't update" })
    ).toHaveTextContent('No update to download');
  });

  it('sits in the tray above the access chip, and unsubscribes only its own listeners', async () => {
    const mock = createMockApi({
      providers: { accessStatus: jest.fn().mockResolvedValue(ok(activeAccess())) },
    });
    const { unmount } = renderWithApp({ api: mock });
    mock.emit('updater:available', { version: '2.1.0' });
    const update = await screen.findByRole('region', { name: 'Update available' });
    const chip = await screen.findByRole('region', { name: 'ParkStay queue' });
    const tray = screen.getByTestId('tray');
    expect(tray).toContainElement(update);
    expect(tray).toContainElement(chip);
    expect(update.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Each subscription is removed with its own unsubscribe (never removeAllListeners).
    expect(mock.subscriberCount('updater:available')).toBe(1);
    unmount();
    await waitFor(() => expect(mock.subscriberCount('updater:available')).toBe(0));
    expect(mock.subscriberCount('updater:progress')).toBe(0);
    expect(mock.subscriberCount('provider:access-status')).toBe(0);
  });
});
