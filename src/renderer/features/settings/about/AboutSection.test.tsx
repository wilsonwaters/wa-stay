import { screen, within } from '@testing-library/react';
import { APP_INFO, createMockApi, ok } from '@tests/utils/renderer/createMockApi';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';
import { PARKSTAY } from '@tests/fixtures/renderer/settings';

function setup(updater: Record<string, jest.Mock> = {}) {
  const mock = createMockApi({
    providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY])) },
    updater,
  });
  return { ...renderWithApp({ route: '/settings/about', api: mock }), mock };
}

const section = async () => {
  const heading = await screen.findByRole('heading', { level: 2, name: 'About WA Stay' });
  return heading.parentElement as HTMLElement;
};

describe('Settings → About', () => {
  it('shows "WA Stay" and the version, the GitHub link and the data folder', async () => {
    setup();
    const about = await section();

    expect(await within(about).findByText(`Version ${APP_INFO.version}`)).toBeInTheDocument();
    expect(
      within(about).getByRole('link', { name: 'GitHub (opens in your browser)' })
    ).toHaveAttribute('href', 'https://github.com/wilsonwaters/wa-stay');
    expect(within(about).getByText(APP_INFO.userDataPath)).toBeInTheDocument();
  });

  it('"Open logs folder" calls app.openLogsFolder', async () => {
    const { user, mock } = setup();
    const about = await section();

    await user.click(within(about).getByRole('button', { name: 'Open logs folder' }));

    expect(mock.api.app.openLogsFolder).toHaveBeenCalledTimes(1);
  });

  it('"Check for updates" renders its result: up to date', async () => {
    const { user, mock } = setup({
      checkForUpdates: jest.fn().mockResolvedValue(ok({ version: APP_INFO.version })),
      getStatus: jest.fn().mockResolvedValue(ok({ state: 'not-available' })),
    });
    const about = await section();

    await user.click(within(about).getByRole('button', { name: 'Check for updates' }));

    const result = await within(about).findByText("You're up to date");
    expect(result).toHaveAttribute('aria-live', 'polite');
    expect(mock.api.updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('"Check for updates" renders its result: a newer version', async () => {
    const { user } = setup({
      checkForUpdates: jest.fn().mockResolvedValue(ok({ version: '2.1.0' })),
      getStatus: jest.fn().mockResolvedValue(ok({ state: 'available', version: '2.1.0' })),
    });
    const about = await section();

    await user.click(within(about).getByRole('button', { name: 'Check for updates' }));

    expect(await within(about).findByText('Version 2.1.0 is available')).toBeInTheDocument();
  });

  it("a check that can't run (offline) says so, with Retry", async () => {
    const checkForUpdates = jest
      .fn()
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok({ version: APP_INFO.version }));
    const { user } = setup({
      checkForUpdates,
      getStatus: jest.fn().mockResolvedValue(ok({ state: 'not-available' })),
    });
    const about = await section();

    await user.click(within(about).getByRole('button', { name: 'Check for updates' }));

    expect(await within(about).findByText("Couldn't check for updates")).toBeInTheDocument();
    await user.click(within(about).getByRole('button', { name: 'Retry' }));
    expect(await within(about).findByText("You're up to date")).toBeInTheDocument();
    expect(checkForUpdates).toHaveBeenCalledTimes(2);
  });
});
