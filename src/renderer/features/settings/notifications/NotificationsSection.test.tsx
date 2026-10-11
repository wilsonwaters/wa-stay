import { act, screen, waitFor } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import { createMockApi, fail, ok } from '@tests/utils/renderer/createMockApi';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';
import { PARKSTAY, politeAnnouncement } from '@tests/fixtures/renderer/settings';

/** A settings store behind `settings.get` / `settings.set`, as main keeps it. */
function settingsStore(initial: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { ...initial };
  const defaults: Record<string, unknown> = {
    'notifications.desktop': true,
    'notifications.sound': true,
  };
  return {
    values,
    get: jest.fn((key: string) => Promise.resolve(ok(key in values ? values[key] : defaults[key]))),
    set: jest.fn((key: string, value: unknown) => {
      values[key] = value;
      return Promise.resolve(ok(true));
    }),
  };
}

function setup(store = settingsStore()) {
  const mock = createMockApi({
    providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY])) },
    settings: { get: store.get, set: store.set },
  });
  return { ...renderWithApp({ route: '/settings/notifications', api: mock }), mock, store };
}

const desktopSwitch = () => screen.findByRole('switch', { name: 'Desktop notifications' });
const soundSwitch = () => screen.getByRole('switch', { name: 'Play a sound' });

describe('Settings → Notifications: desktop switches', () => {
  it('switching Desktop notifications off writes notifications.desktop=false, and it is still off after a remount', async () => {
    const store = settingsStore();
    const { user } = setup(store);
    const desktop = await desktopSwitch();
    await waitFor(() => expect(desktop).toBeChecked());

    await user.click(desktop);

    expect(store.set).toHaveBeenCalledWith('notifications.desktop', false);
    expect(desktop).not.toBeChecked();
    await waitFor(() => expect(politeAnnouncement()).toBe('Desktop notifications off'));

    // A fresh app on the same stored settings
    cleanup();
    document.body.innerHTML = '';
    setup(store);
    const again = await desktopSwitch();
    await waitFor(() => expect(store.get).toHaveBeenCalledWith('notifications.desktop'));
    await waitFor(() => expect(again).not.toBeChecked());
  });

  it('every switch has a visible label and a description linked by aria-describedby', async () => {
    setup();
    const desktop = await desktopSwitch();

    expect(desktop).toHaveAccessibleDescription(
      'Pop-up alerts on your desktop when a watch finds a site or a site is held. Everything also appears under the bell.'
    );
    expect(soundSwitch()).toHaveAccessibleDescription("Uses your system's notification sound.");
  });

  it('Sound is disabled while desktop is off, saying it requires desktop notifications', async () => {
    setup(settingsStore({ 'notifications.desktop': false }));
    const desktop = await desktopSwitch();
    await waitFor(() => expect(desktop).not.toBeChecked());

    expect(soundSwitch()).toBeDisabled();
    expect(soundSwitch()).toHaveAccessibleDescription('Requires desktop notifications.');
    expect(desktop).toHaveAccessibleDescription(
      "Pop-up alerts are off. Held sites expire quickly; you'll only see them in WA Stay or by email."
    );
  });

  it('switching sound off writes notifications.sound=false', async () => {
    const store = settingsStore();
    const { user } = setup(store);
    await desktopSwitch();
    await waitFor(() => expect(soundSwitch()).toBeEnabled());

    await user.click(soundSwitch());

    expect(store.set).toHaveBeenCalledWith('notifications.sound', false);
    await waitFor(() => expect(politeAnnouncement()).toBe('Sound off'));
  });

  it('a failed save puts the switch back and says so', async () => {
    const store = settingsStore();
    store.set.mockResolvedValueOnce(fail('The database is busy'));
    const { user } = setup(store);
    const desktop = await desktopSwitch();
    await waitFor(() => expect(desktop).toBeChecked());

    await user.click(desktop);

    expect(await screen.findByText("Couldn't save that setting. Try again.")).toBeInTheDocument();
    await waitFor(() => expect(desktop).toBeChecked());
  });

  it('an empty answer from settings.get falls back to the defaults (desktop and sound on)', async () => {
    const store = settingsStore();
    store.get.mockResolvedValue(ok(null));
    setup(store);
    const desktop = await desktopSwitch();

    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(desktop).toBeChecked();
    expect(soundSwitch()).toBeChecked();
  });
});
