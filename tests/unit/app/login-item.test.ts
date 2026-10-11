/**
 * @jest-environment node
 *
 * Launch at login (`app/login-item.ts`), against a fake Electron `app` that keeps the
 * HKCU Run values the way Electron 28 does on Windows (shell/browser/browser_win.cc):
 *
 * - `setLoginItemSettings` writes `<path> <args joined by spaces>` under `name` (default:
 *   the AppUserModelId), or deletes `name` when `openAtLogin` is false;
 * - `getLoginItemSettings({ path }).launchItems` lists the values whose program (the first
 *   token of the command line, so an unquoted path stops at its first space) equals the
 *   lookup path's program, case-insensitively.
 *
 * What these fakes cannot show is checked by hand on Windows (B3 manual checklist): the
 * real `reg query` output and Windows starting the entry at login.
 */
import {
  LEGACY_LOGIN_ITEM_NAMES,
  launchAtLoginSupported,
  legacyStartMinimised,
  replaceLegacyLoginItems,
  setLaunchAtLogin,
  type StartMinimisedStore,
  type LoginItemApp,
  type LoginItemHost,
} from '@main/app/login-item';

const AUMID = 'com.parkstay.bookings';
const PROGRAMS = 'C:\\Users\\Ann Lee\\AppData\\Local\\Programs';
const LEGACY_EXE = `${PROGRAMS}\\WA ParkStay Bookings\\WA ParkStay Bookings.exe`;
/** An unattended upgrade keeps v1.x's install folder (BQ7). */
const EXE_IN_PLACE = `${PROGRAMS}\\WA ParkStay Bookings\\WA Stay.exe`;
/** An interactive upgrade nests WA Stay inside it (BQ7). */
const EXE_NESTED = `${PROGRAMS}\\WA ParkStay Bookings\\WA Stay\\WA Stay.exe`;

/** The first token of a Windows command line, as Chromium's CommandLine::GetProgram reads it. */
function program(commandLine: string): string {
  const match = commandLine.match(/^\s*"([^"]*)"|^\s*(\S+)/);
  return match ? (match[1] ?? match[2]) : '';
}

/** Splits a command line the same way, for `launchItems[].args`. */
function args(commandLine: string): string[] {
  const rest = commandLine.replace(/^\s*("[^"]*"|\S+)/, '');
  return rest.match(/"[^"]*"|\S+/g)?.map((arg) => arg.replace(/"/g, '')) ?? [];
}

class FakeRunKey implements LoginItemApp {
  readonly values = new Map<string, string>();
  readonly calls: string[] = [];

  constructor(readonly isPackaged = true) {}

  setLoginItemSettings(settings: {
    openAtLogin: boolean;
    path?: string;
    args?: string[];
    name?: string;
  }): void {
    const name = settings.name ?? AUMID;
    this.calls.push(`${settings.openAtLogin ? 'set' : 'delete'} ${name}`);
    if (!settings.openAtLogin) {
      this.values.delete(name);
      return;
    }
    const command = [settings.path ?? '', ...(settings.args ?? [])].join(' ');
    this.values.set(name, command);
  }

  getLoginItemSettings(options: { path?: string } = {}) {
    const lookup = program(options.path ?? '').toLowerCase();
    const launchItems = [...this.values]
      .filter(([, command]) => program(command).toLowerCase() === lookup)
      .map(([name, command]) => ({
        name,
        path: program(command),
        args: args(command),
        scope: 'user',
        enabled: true,
      }));
    return { launchItems };
  }
}

function host(
  app: FakeRunKey,
  overrides: Partial<Omit<LoginItemHost, 'app'>> = {}
): LoginItemHost & { lines: string[] } {
  const lines: string[] = [];
  return {
    app,
    platform: 'win32',
    execPath: EXE_IN_PLACE,
    env: {},
    log: { info: (message: string) => lines.push(message) },
    lines,
    ...overrides,
  };
}

/** The Run values v1.2.0 wrote: Electron's default name, the exe path unquoted. */
function v1RunKey(app: FakeRunKey, exe: string = LEGACY_EXE): void {
  app.values.set('electron.app.WA ParkStay Bookings', `${exe} --hidden`);
}

/** A stored "Start minimised" choice (null: none stored). */
function store(
  initial: boolean | null
): StartMinimisedStore & { value: boolean | null; set: jest.Mock } {
  const s = {
    value: initial,
    get: () => s.value,
    set: jest.fn((value: boolean) => {
      s.value = value;
    }),
  };
  return s;
}

describe('launchAtLoginSupported', () => {
  it('Windows and macOS only: Electron cannot register a login item on Linux', () => {
    expect(launchAtLoginSupported('win32')).toBe(true);
    expect(launchAtLoginSupported('darwin')).toBe(true);
    expect(launchAtLoginSupported('linux')).toBe(false);
  });
});

describe('setLaunchAtLogin', () => {
  it('Windows: the default name (the AppUserModelId) and the quoted executable, no --hidden', () => {
    const app = new FakeRunKey();

    setLaunchAtLogin({ enabled: true, startMinimised: false }, host(app));

    expect(app.values).toEqual(new Map([[AUMID, `"${EXE_IN_PLACE}"`]]));
  });

  it('Windows: --hidden only when start minimised is on (written again when it changes)', () => {
    const app = new FakeRunKey();

    setLaunchAtLogin({ enabled: true, startMinimised: true }, host(app));
    expect(app.values).toEqual(new Map([[AUMID, `"${EXE_IN_PLACE}" --hidden`]]));

    setLaunchAtLogin({ enabled: true, startMinimised: false }, host(app));
    expect(app.values).toEqual(new Map([[AUMID, `"${EXE_IN_PLACE}"`]]));
  });

  it('portable: the entry starts the portable exe (PORTABLE_EXECUTABLE_FILE), not the temp copy', () => {
    const app = new FakeRunKey();
    const portable = 'D:\\Apps\\WA Stay 2.0.0.exe';

    setLaunchAtLogin(
      { enabled: true, startMinimised: true },
      host(app, {
        execPath: 'C:\\Users\\Ann\\AppData\\Local\\Temp\\2abcd\\WA Stay.exe',
        env: { PORTABLE_EXECUTABLE_FILE: portable },
      })
    );

    expect(app.values.get(AUMID)).toBe(`"${portable}" --hidden`);
  });

  it('off: removes the entry', () => {
    const app = new FakeRunKey();
    setLaunchAtLogin({ enabled: true, startMinimised: true }, host(app));

    setLaunchAtLogin({ enabled: false, startMinimised: true }, host(app));

    expect(app.values.size).toBe(0);
  });

  // Electron 44 removed `openAsHidden`: it worked only on macOS 12 and earlier, which Electron
  // no longer supports
  it.each([true, false])(
    'macOS: a login item, without the removed openAsHidden (start minimised %s)',
    (startMinimised) => {
      const app = {
        isPackaged: true,
        getLoginItemSettings: jest.fn(),
        setLoginItemSettings: jest.fn(),
      };

      setLaunchAtLogin(
        { enabled: true, startMinimised },
        { app, platform: 'darwin', execPath: '/Applications/WA Stay.app', env: {} }
      );

      expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
    }
  );
});

describe('replaceLegacyLoginItems (after the first-run migration)', () => {
  it('Windows, packaged, launch at login on: removes the v1.x entry and registers WA Stay with --hidden', () => {
    const app = new FakeRunKey();
    v1RunKey(app);
    // Unrelated entries: one sharing the unquoted prefix, one quoted elsewhere
    app.values.set('Other App', `${PROGRAMS}\\WA Other\\Other.exe --minimised`);
    app.values.set(
      'Discord',
      `"C:\\Users\\Ann Lee\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe`
    );
    const h = host(app);

    const result = replaceLegacyLoginItems(
      { launchOnStartup: true, startMinimised: store(null) },
      h
    );

    expect(app.values).toEqual(
      new Map([
        ['Other App', `${PROGRAMS}\\WA Other\\Other.exe --minimised`],
        [
          'Discord',
          `"C:\\Users\\Ann Lee\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe`,
        ],
        [AUMID, `"${EXE_IN_PLACE}" --hidden`],
      ])
    );
    expect(result).toEqual({
      removed: ['electron.app.WA ParkStay Bookings', 'electron.app.parkstay-bookings'],
      registered: true,
    });
    // Removed before the new entry is written
    expect(app.calls.indexOf(`set ${AUMID}`)).toBe(app.calls.length - 1);
    expect(h.lines).toContain('legacy-install: launch at login registered for WA Stay, minimised');
  });

  it('finds a v1.x entry under any name through launchItems, from the nested install folder too', () => {
    const app = new FakeRunKey();
    app.values.set('My renamed entry', `${LEGACY_EXE} --hidden`);

    const result = replaceLegacyLoginItems(
      { launchOnStartup: true, startMinimised: store(null) },
      host(app, { execPath: EXE_NESTED })
    );

    expect(result.removed).toEqual(['My renamed entry', ...LEGACY_LOGIN_ITEM_NAMES]);
    expect(app.values).toEqual(new Map([[AUMID, `"${EXE_NESTED}" --hidden`]]));
  });

  it('removes the candidate names even when the lookup cannot see them (e.g. the portable build)', () => {
    const app = new FakeRunKey();
    app.values.set(
      'electron.app.parkstay-bookings',
      'C:\\Users\\Ann\\AppData\\Local\\Temp\\1xyz\\WA ParkStay Bookings.exe --hidden'
    );
    const portable = 'D:\\Apps\\WA Stay 2.0.0.exe';

    replaceLegacyLoginItems(
      { launchOnStartup: true, startMinimised: store(null) },
      host(app, {
        execPath: 'C:\\Users\\Ann\\AppData\\Local\\Temp\\2abcd\\WA Stay.exe',
        env: { PORTABLE_EXECUTABLE_FILE: portable },
      })
    );

    expect(app.values).toEqual(new Map([[AUMID, `"${portable}" --hidden`]]));
  });

  it('launch at login off: nothing is registered (the dangling v1.x entry still goes)', () => {
    const app = new FakeRunKey();
    v1RunKey(app);

    expect(
      replaceLegacyLoginItems({ launchOnStartup: false, startMinimised: store(null) }, host(app))
    ).toMatchObject({ registered: false });

    expect(app.values.size).toBe(0);
  });

  it('unpackaged (running from source): nothing is removed or registered', () => {
    const app = new FakeRunKey(false);
    v1RunKey(app);

    expect(
      replaceLegacyLoginItems({ launchOnStartup: true, startMinimised: store(null) }, host(app))
    ).toEqual({ removed: [], registered: false });

    expect(app.calls).toEqual([]);
    expect(app.values.size).toBe(1);
  });

  it.each(['darwin', 'linux'] as const)(
    '%s: nothing (v1.x shipped only for Windows)',
    (platform) => {
      const app = new FakeRunKey();

      expect(
        replaceLegacyLoginItems(
          { launchOnStartup: true, startMinimised: store(null) },
          host(app, { platform })
        )
      ).toEqual({
        removed: [],
        registered: false,
      });
      expect(app.calls).toEqual([]);
    }
  );
});

describe('legacyStartMinimised (a v1.x user keeps a quiet start)', () => {
  it('turns start minimised on for a v1.x user who had launch at login on', () => {
    const settings = store(null);

    expect(legacyStartMinimised(true, settings)).toBe(true);
    expect(settings.value).toBe(true);
  });

  it('is idempotent: a second run (or a stored choice) changes nothing', () => {
    const settings = store(null);
    legacyStartMinimised(true, settings);
    expect(legacyStartMinimised(true, settings)).toBe(true);
    expect(settings.set).toHaveBeenCalledTimes(1);

    // The person turned it off since: kept
    const changed = store(false);
    expect(legacyStartMinimised(true, changed)).toBe(false);
    expect(changed.set).not.toHaveBeenCalled();
  });

  it('launch at login off: nothing is stored', () => {
    const settings = store(null);

    expect(legacyStartMinimised(false, settings)).toBe(false);
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('stays consistent with the replaced entry: the new Run value carries --hidden', () => {
    const app = new FakeRunKey();
    v1RunKey(app);
    const settings = store(null);

    replaceLegacyLoginItems({ launchOnStartup: true, startMinimised: settings }, host(app));

    expect(settings.value).toBe(true);
    expect(app.values).toEqual(new Map([[AUMID, `"${EXE_IN_PLACE}" --hidden`]]));
  });

  it('a choice the person already stored is kept for the replaced entry', () => {
    const app = new FakeRunKey();
    v1RunKey(app);
    const settings = store(false);

    replaceLegacyLoginItems({ launchOnStartup: true, startMinimised: settings }, host(app));

    expect(settings.set).not.toHaveBeenCalled();
    expect(app.values).toEqual(new Map([[AUMID, `"${EXE_IN_PLACE}"`]]));
  });

  it.each([
    ['macOS', { platform: 'darwin' as const }, true],
    ['Linux', { platform: 'linux' as const }, true],
    ['a dev build on Windows', {}, false],
  ])(
    '%s: nothing is replaced, so start minimised is not stored either',
    (_case, overrides, packaged) => {
      const app = new FakeRunKey(packaged);
      const settings = store(null);

      replaceLegacyLoginItems(
        { launchOnStartup: true, startMinimised: settings },
        host(app, overrides)
      );

      expect(settings.set).not.toHaveBeenCalled();
      expect(settings.value).toBeNull();
    }
  );
});
