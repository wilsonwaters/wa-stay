import { screen, waitFor } from '@testing-library/react';
import { createMockApi, fail, ok } from '@tests/utils/renderer/createMockApi';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';
import { PARKSTAY, politeAnnouncement } from '@tests/fixtures/renderer/settings';

const REFUSED =
  'Starting at sign-in is only available in the installed app, not when running from source.';

function setup(
  launch = { enabled: false, startMinimised: false, supported: true },
  setAutoLaunch?: jest.Mock
) {
  let stored = launch;
  const mock = createMockApi({
    providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY])) },
    app: {
      getAutoLaunch: jest.fn(() => Promise.resolve(ok(stored))),
      setAutoLaunch:
        setAutoLaunch ??
        jest.fn((enabled: boolean, startMinimised?: boolean) => {
          stored = { ...stored, enabled, startMinimised: startMinimised ?? stored.startMinimised };
          return Promise.resolve(ok(stored));
        }),
    },
  });
  return { ...renderWithApp({ route: '/settings/app', api: mock }), mock };
}

const launchSwitch = () => screen.findByRole('switch', { name: 'Start WA Stay when you sign in' });
const minimisedSwitch = () => screen.getByRole('switch', { name: 'Start minimised' });

describe('Settings → App', () => {
  it('reflects app.getAutoLaunch', async () => {
    setup({ enabled: true, startMinimised: true, supported: true });

    expect(await launchSwitch()).toBeChecked();
    expect(minimisedSwitch()).toBeChecked();
    expect(minimisedSwitch()).toBeEnabled();
  });

  it('a rejected setAutoLaunch shows its error inline and the switch returns to off', async () => {
    const { user } = setup(undefined, jest.fn().mockResolvedValue(fail(REFUSED)));
    const launch = await launchSwitch();

    await user.click(launch);

    expect(await screen.findByRole('alert')).toHaveTextContent(REFUSED);
    await waitFor(() => expect(launch).not.toBeChecked());
    expect(launch).toHaveAccessibleDescription(expect.stringContaining(REFUSED));
  });

  it('Start minimised is disabled while launch at login is off, and says why', async () => {
    setup();
    await launchSwitch();

    expect(minimisedSwitch()).toBeDisabled();
    expect(minimisedSwitch()).toHaveAccessibleDescription(
      'Requires starting WA Stay when you sign in.'
    );
  });

  it('turning launch at login on, then Start minimised, calls setAutoLaunch and announces each', async () => {
    const { user, mock } = setup();
    const launch = await launchSwitch();

    await user.click(launch);
    expect(mock.api.app.setAutoLaunch).toHaveBeenLastCalledWith(true, undefined);
    await waitFor(() => expect(minimisedSwitch()).toBeEnabled());
    await waitFor(() => expect(politeAnnouncement()).toBe('Start when you sign in on'));

    await user.click(minimisedSwitch());
    expect(mock.api.app.setAutoLaunch).toHaveBeenLastCalledWith(true, true);
    await waitFor(() => expect(minimisedSwitch()).toBeChecked());
    expect(minimisedSwitch()).toHaveAccessibleDescription(
      'Opens in the taskbar instead of on screen.'
    );
    await waitFor(() => expect(politeAnnouncement()).toBe('Start minimised on'));
  });

  it('says plainly that closing the window quits WA Stay (there is no tray)', async () => {
    setup();
    await launchSwitch();

    expect(
      screen.getByText('Closing the WA Stay window quits it; watches stop until you open it again.')
    ).toBeInTheDocument();
  });

  it('where the OS cannot start apps at sign-in (Linux), both switches are unavailable and say so', async () => {
    const { mock } = setup({ enabled: false, startMinimised: false, supported: false });
    const launch = await launchSwitch();

    expect(launch).toBeDisabled();
    expect(launch).toHaveAccessibleDescription(
      expect.stringContaining('Available on Windows and macOS only.')
    );
    expect(minimisedSwitch()).toBeDisabled();
    expect(mock.api.app.setAutoLaunch).not.toHaveBeenCalled();
  });
});
