/**
 * The test-only env hooks and fixture mode (architecture-notes §12.14): honoured only when the
 * app runs from source (unpackaged, and not loaded from an asar archive). A packaged build,
 * even one whose executable was renamed to `electron` (so Electron reports it unpackaged),
 * ignores every variable, sets no userData and installs no network guard. In fixture mode the
 * guard cancels http(s)/ws(s) requests on the default session and every later session
 * (provider partitions), except to allowed hosts, and logs them. `WA_STAY_PROVIDERS` narrows the
 * built-in providers to those it lists, and refuses an id that is not built in.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { isInsideAsar, runsFromSource } from '@main/app/app-source';
import {
  applyTestEnvHooks,
  installNetworkGuard,
  isBlockedRequest,
  readUnexpectedRequests,
  resolveTestHooks,
  selectProviders,
  startFixtureMode,
  type GuardRequestDetails,
  type GuardableSession,
  type SessionSource,
} from '@main/testing';

/** `app.getAppPath()` from a source checkout, and in an installed (packaged) app. */
const SOURCE_APP_PATH = '/repo';
const PACKAGED_APP_PATH = '/opt/WA Stay/resources/app.asar';

const ALL_HOOKS = {
  WA_STAY_USER_DATA_DIR: '/tmp/wa-stay-e2e-profile',
  WA_STAY_LEGACY_DATA_DIR: '/tmp/wa-stay-e2e-legacy',
  WA_STAY_E2E_FIXTURES_DIR: 'tests/e2e/fixtures/http',
  WA_STAY_E2E_ALLOW_HOSTS: 'api.mapbox.com, Events.Mapbox.com',
  WA_STAY_PROVIDERS: ' parkstay , example-api',
};

type Listener = (
  details: GuardRequestDetails,
  callback: (response: { cancel?: boolean }) => void
) => void;

class FakeSession implements GuardableSession {
  listener?: Listener;
  readonly webRequest = {
    onBeforeRequest: jest.fn((listener: Listener) => {
      this.listener = listener;
    }),
  };

  /** What the guard decides for a request: cancelled or let through. */
  request(url: string, resourceType = 'xhr'): 'cancelled' | 'allowed' {
    let decision: 'cancelled' | 'allowed' = 'allowed';
    this.listener?.({ url, method: 'GET', resourceType }, (response) => {
      decision = response.cancel ? 'cancelled' : 'allowed';
    });
    return decision;
  }
}

class FakeApp implements SessionSource {
  readonly listeners: Array<(session: GuardableSession) => void> = [];
  readonly setPath = jest.fn();
  constructor(
    readonly isPackaged: boolean,
    private readonly appPath = isPackaged ? PACKAGED_APP_PATH : SOURCE_APP_PATH
  ) {}
  getAppPath(): string {
    return this.appPath;
  }
  on(_event: 'session-created', listener: (session: GuardableSession) => void): this {
    this.listeners.push(listener);
    return this;
  }
  createSession(): FakeSession {
    const session = new FakeSession();
    this.listeners.forEach((listener) => listener(session));
    return session;
  }
}

let userDataDir: string;
const log = { warn: jest.fn() };

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-fixture-mode-'));
  log.warn.mockClear();
});

afterEach(() => {
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

/**
 * A packaged app as Electron reports it: installed, or with its executable renamed to
 * `electron`, which makes `isPackaged` false while the code still comes from `app.asar`.
 */
const PACKAGED_APPS: Array<[string, () => FakeApp]> = [
  ['packaged', () => new FakeApp(true)],
  ['renamed to electron (isPackaged false, app.asar)', () => new FakeApp(false, PACKAGED_APP_PATH)],
  [
    'renamed to electron.exe (Windows path)',
    () => new FakeApp(false, 'C:\\Program Files\\WA Stay\\resources\\app.asar'),
  ],
];

describe.each(PACKAGED_APPS)('%s: the hooks are inert even with every variable set', (_, make) => {
  it('resolves no hooks and never changes userData', () => {
    const app = make();

    expect(
      resolveTestHooks({
        env: ALL_HOOKS,
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        cwd: '/repo',
      })
    ).toEqual({});
    expect(applyTestEnvHooks(app, ALL_HOOKS, '/repo')).toEqual({});
    expect(app.setPath).not.toHaveBeenCalled();
  });

  it('installs neither fixture mode nor the network guard', () => {
    const app = make();
    const defaultSession = new FakeSession();

    const hooks = applyTestEnvHooks(app, ALL_HOOKS, '/repo');
    const fixtureMode = startFixtureMode(hooks, {
      app,
      session: { defaultSession },
      userDataDir,
      log,
    });

    expect(fixtureMode).toBeUndefined();
    expect(defaultSession.webRequest.onBeforeRequest).not.toHaveBeenCalled();
    expect(app.listeners).toHaveLength(0);
    expect(app.createSession().webRequest.onBeforeRequest).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe('runsFromSource', () => {
  it('is true only unpackaged with an app path outside any asar archive', () => {
    expect(runsFromSource({ isPackaged: false, appPath: '/home/ann/wa-stay' })).toBe(true);
    expect(runsFromSource({ isPackaged: false, appPath: 'C:\\src\\wa-stay' })).toBe(true);
    expect(runsFromSource({ isPackaged: true, appPath: '/home/ann/wa-stay' })).toBe(false);
    expect(runsFromSource({ isPackaged: false, appPath: PACKAGED_APP_PATH })).toBe(false);
    expect(runsFromSource({ isPackaged: false, appPath: '/x/resources/APP.ASAR/dist' })).toBe(
      false
    );
    expect(runsFromSource({ isPackaged: false, appPath: 'D:\\WA Stay\\resources\\app.asar' })).toBe(
      false
    );
  });

  it('reads an asar archive only from a whole path segment', () => {
    expect(isInsideAsar('/opt/app.asar')).toBe(true);
    expect(isInsideAsar('/opt/app.asar/dist/main')).toBe(true);
    expect(isInsideAsar('/opt/app.asar.unpacked')).toBe(false);
    expect(isInsideAsar('/home/ann/asar-tools/wa-stay')).toBe(false);
  });
});

describe('from source (unpackaged, not in an asar archive)', () => {
  it('overrides userData and resolves every hook, relative paths against cwd', () => {
    const app = new FakeApp(false);

    const hooks = applyTestEnvHooks(app, ALL_HOOKS, '/repo');

    expect(app.setPath).toHaveBeenCalledWith('userData', path.resolve('/tmp/wa-stay-e2e-profile'));
    expect(hooks).toEqual({
      userDataDir: path.resolve('/tmp/wa-stay-e2e-profile'),
      legacyDataDir: path.resolve('/tmp/wa-stay-e2e-legacy'),
      fixtureMode: {
        fixturesDir: path.resolve('/repo', 'tests/e2e/fixtures/http'),
        allowHosts: ['api.mapbox.com', 'events.mapbox.com'],
      },
      providers: ['parkstay', 'example-api'],
    });
  });

  it('with no variables (or empty ones) changes nothing', () => {
    const app = new FakeApp(false);

    expect(
      applyTestEnvHooks(app, { WA_STAY_USER_DATA_DIR: ' ', WA_STAY_PROVIDERS: ' ' }, '/repo')
    ).toEqual({});
    expect(app.setPath).not.toHaveBeenCalled();
  });

  it('disables the legacy source when userData is overridden without a legacy folder (B3)', () => {
    const env = { WA_STAY_USER_DATA_DIR: '/tmp/profile' };
    expect(
      resolveTestHooks({ env, isPackaged: false, appPath: SOURCE_APP_PATH, cwd: '/repo' })
    ).toEqual({
      userDataDir: path.resolve('/tmp/profile'),
      legacyDataDir: null,
    });
  });

  it('fixture mode guards the default session and every later one, and returns the client options', () => {
    const app = new FakeApp(false);
    const defaultSession = new FakeSession();
    const hooks = applyTestEnvHooks(
      app,
      { WA_STAY_E2E_FIXTURES_DIR: '/fixtures', WA_STAY_USER_DATA_DIR: userDataDir },
      '/repo'
    );

    const fixtureMode = startFixtureMode(hooks, {
      app,
      session: { defaultSession },
      userDataDir,
      log,
    });

    const logFile = path.join(userDataDir, 'e2e-unexpected-requests.log');
    expect(fixtureMode).toEqual({ fixturesDir: path.resolve('/fixtures'), logFile });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Test fixture mode'));

    // The default session and a provider partition created later are both guarded
    const partition = app.createSession();
    expect(defaultSession.request('https://parkstay.dbca.wa.gov.au/api/x', 'image')).toBe(
      'cancelled'
    );
    expect(partition.request('https://parkstay.dbca.wa.gov.au/api/y')).toBe('cancelled');
    expect(defaultSession.request('file:///repo/dist/renderer/index.html', 'mainFrame')).toBe(
      'allowed'
    );
    expect(readUnexpectedRequests(logFile)).toEqual([
      expect.objectContaining({
        source: 'network-guard',
        method: 'GET',
        url: 'https://parkstay.dbca.wa.gov.au/api/x',
        resourceType: 'image',
      }),
      expect.objectContaining({ url: 'https://parkstay.dbca.wa.gov.au/api/y' }),
    ]);
  });
});

describe('the network guard', () => {
  it('cancels http, https, ws and wss except to allowed hosts and their subdomains', () => {
    const allow = ['mapbox.com'];
    expect(isBlockedRequest('http://example.com/', allow)).toBe(true);
    expect(isBlockedRequest('https://example.com/', allow)).toBe(true);
    expect(isBlockedRequest('ws://example.com/', allow)).toBe(true);
    expect(isBlockedRequest('wss://example.com/', allow)).toBe(true);
    expect(isBlockedRequest('https://127.0.0.1:3000/', allow)).toBe(true);
    expect(isBlockedRequest('https://mapbox.com/', allow)).toBe(false);
    expect(isBlockedRequest('https://API.mapbox.com/v4', allow)).toBe(false);
    expect(isBlockedRequest('https://notmapbox.com/', allow)).toBe(true);
    expect(isBlockedRequest('https://mapbox.com.evil.example/', allow)).toBe(true);
    for (const local of ['file:///a.html', 'data:text/plain,x', 'blob:file:///1', 'devtools://x']) {
      expect(isBlockedRequest(local, [])).toBe(false);
    }
  });

  it('guards a session once, however often it is seen', () => {
    const app = new FakeApp(false);
    const session = new FakeSession();

    installNetworkGuard({
      sessions: [session],
      app,
      allowHosts: [],
      logFile: path.join(userDataDir, 'log'),
    });
    app.listeners.forEach((listener) => listener(session));

    expect(session.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
  });
});

describe('WA_STAY_PROVIDERS: the built-in providers to register', () => {
  const BUILT_INS = [{ id: 'parkstay' }, { id: 'example-api' }, { id: 'rac' }];
  const fromSource = (value: string) =>
    resolveTestHooks({
      env: { WA_STAY_PROVIDERS: value },
      isPackaged: false,
      appPath: SOURCE_APP_PATH,
      cwd: '/repo',
    });

  it('unset: every built-in provider, as built in', () => {
    expect(selectProviders({}, BUILT_INS)).toBe(BUILT_INS);
  });

  it('registers only the listed ones, in their built-in order', () => {
    expect(selectProviders(fromSource('parkstay'), BUILT_INS)).toEqual([{ id: 'parkstay' }]);
    expect(selectProviders(fromSource('rac,parkstay,rac'), BUILT_INS)).toEqual([
      { id: 'parkstay' },
      { id: 'rac' },
    ]);
  });

  it('fails loudly on an id that is not built in, naming it and the built-in ones', () => {
    expect(() => selectProviders(fromSource('parkstay,ParkStay,bush-camps'), BUILT_INS)).toThrow(
      'WA_STAY_PROVIDERS names "ParkStay", "bush-camps", not a built-in provider. ' +
        'The built-in providers are: parkstay, example-api, rac.'
    );
  });

  it('fails loudly on a list that names no provider', () => {
    expect(fromSource(' , ')).toEqual({ providers: [] });
    expect(() => selectProviders(fromSource(' , '), BUILT_INS)).toThrow(
      'WA_STAY_PROVIDERS names no provider. The built-in providers are: parkstay, example-api, rac.'
    );
  });

  it.each(PACKAGED_APPS)('%s: ignored, even naming a provider that is not built in', (_, make) => {
    const app = make();
    const hooks = resolveTestHooks({
      env: { WA_STAY_PROVIDERS: 'not-a-provider' },
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      cwd: '/repo',
    });

    expect(hooks).toEqual({});
    expect(selectProviders(hooks, BUILT_INS)).toBe(BUILT_INS);
  });
});
