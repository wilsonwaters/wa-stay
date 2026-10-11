/**
 * handle(def, fn): sender checks, payload validation and APIResponse mapping, and logging
 * that never carries payload values.
 */

import { z } from 'zod';
import { contract } from '@shared/contracts';
import { NotifierChannel } from '@shared/types';
import { createHandle, HandlerFn } from '@main/ipc/handle';
import type { MethodDef } from '@shared/contracts/define';
import { createSenderGuard } from '@main/ipc/sender-guard';
import { createAppUrlMatcher } from '@main/app/renderer-entry';
import { AppError } from '@main/utils/app-error';
import { logger } from '@main/utils/logger';
import {
  AccessGateError,
  ProviderAuthRequiredError,
  ProviderCapabilityError,
  ProviderHttpError,
  UnknownProviderError,
} from '@main/providers/sdk/errors';
import {
  APP_INDEX_PATH,
  FakeIpcMain,
  fakeEvent,
  topFrame,
  TRUSTED_SENDER_ID,
} from '@tests/utils/ipc-harness';

jest.mock('electron', () => ({ ipcMain: { handle: jest.fn() } }));

const SECRET = 'hunter2-app-password';

describe('handle()', () => {
  let ipc: FakeIpcMain;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  const isTrustedSender = createSenderGuard({
    isTrustedWebContents: (id) => id === TRUSTED_SENDER_ID,
    isAppUrl: createAppUrlMatcher({ kind: 'file', path: APP_INDEX_PATH }),
  });

  function register<D extends MethodDef>(def: D, fn: HandlerFn<D>): void {
    createHandle({ isTrustedSender, ipc })(def, fn);
  }

  function logged(): string {
    return JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
  }

  beforeEach(() => {
    ipc = new FakeIpcMain();
    warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    error = jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs the handler with the parsed payload and wraps its result', async () => {
    const fn = jest.fn().mockResolvedValue(null);
    register(contract.watches.get, fn);

    await expect(ipc.invoke('watches:get', fakeEvent(), { id: 7 })).resolves.toEqual({
      success: true,
      data: null,
    });
    expect(fn).toHaveBeenCalledWith({ id: 7 });
  });

  it("rejects watches.get with { id: 'abc' } as VALIDATION without calling the service", async () => {
    const service = { get: jest.fn() };
    register(contract.watches.get, ({ id }) => service.get(id));

    const response = await ipc.invoke('watches:get', fakeEvent(), { id: 'abc' });

    expect(response).toMatchObject({ success: false, code: 'VALIDATION', issues: ['id'] });
    expect(service.get).not.toHaveBeenCalled();
  });

  it('rejects a second positional argument as VALIDATION', async () => {
    const fn = jest.fn();
    register(contract.watches.get, fn);

    await expect(ipc.invoke('watches:get', fakeEvent(), { id: 1 }, 2)).resolves.toMatchObject({
      success: false,
      code: 'VALIDATION',
    });
    expect(fn).not.toHaveBeenCalled();
  });

  describe('sender checks: FORBIDDEN without running the handler', () => {
    it.each([
      ['an untrusted sender.id', fakeEvent({ senderId: 99 })],
      ['a null senderFrame (navigating or destroyed)', fakeEvent({ frame: null })],
      ['a sub-frame', fakeEvent({ frame: { url: topFrame().url, parent: topFrame() } })],
      [
        'a frame URL of https://evil.example',
        fakeEvent({ frame: topFrame('https://evil.example') }),
      ],
      ['another local file', fakeEvent({ frame: topFrame('file:///etc/passwd') })],
    ])('%s', async (_case, event) => {
      const fn = jest.fn();
      register(contract.watches.list, fn);

      await expect(ipc.invoke('watches:list', event)).resolves.toEqual({
        success: false,
        code: 'FORBIDDEN',
        error: 'Forbidden',
      });
      expect(fn).not.toHaveBeenCalled();
    });

    it('a provider sign-in or payment window is FORBIDDEN, even registered as trusted', async () => {
      const fn = jest.fn();
      const event = fakeEvent();
      createHandle({
        isTrustedSender: createSenderGuard({
          isTrustedWebContents: () => true,
          isAppUrl: () => true,
          isProviderWindow: (sender) => sender === event.sender,
        }),
        ipc,
      })(contract.watches.list, fn);

      await expect(ipc.invoke('watches:list', event)).resolves.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(fn).not.toHaveBeenCalled();
    });

    it('a guard that throws (frame disposed mid-check) is FORBIDDEN, not a crash', async () => {
      const fn = jest.fn();
      createHandle({
        isTrustedSender: () => {
          throw new Error('Render frame was disposed before WebFrameMain could be accessed');
        },
        ipc,
      })(contract.watches.list, fn);

      await expect(ipc.invoke('watches:list', fakeEvent())).resolves.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('error mapping', () => {
    it.each(['NO_PROFILE', 'NOT_FOUND', 'VALIDATION'] as const)(
      'AppError(%s) keeps its code and message',
      async (code) => {
        register(contract.watches.list, () => {
          throw new AppError(code, `because ${code}`);
        });

        await expect(ipc.invoke('watches:list', fakeEvent())).resolves.toEqual({
          success: false,
          code,
          error: `because ${code}`,
        });
      }
    );

    it("an Error becomes INTERNAL with the Error's message", async () => {
      register(contract.watches.list, async () => {
        throw new Error('database is locked');
      });

      await expect(ipc.invoke('watches:list', fakeEvent())).resolves.toEqual({
        success: false,
        code: 'INTERNAL',
        error: 'database is locked',
      });
    });

    it('a non-Error throw becomes INTERNAL "Unexpected error"', async () => {
      register(contract.watches.list, () => {
        throw { reason: 'not an Error' };
      });

      await expect(ipc.invoke('watches:list', fakeEvent())).resolves.toEqual({
        success: false,
        code: 'INTERNAL',
        error: 'Unexpected error',
      });
    });

    it.each([
      ['ProviderCapabilityError', 'CAPABILITY', new ProviderCapabilityError('fake', 'holds')],
      ['UnknownProviderError', 'UNKNOWN_PROVIDER', new UnknownProviderError('nope')],
      [
        'ProviderHttpError',
        'PROVIDER_ERROR',
        new ProviderHttpError({ providerId: 'fake', status: 503, url: 'https://x.example/a?q=1' }),
      ],
      ['AccessGateError', 'ACCESS_GATE', new AccessGateError('fake', 'waiting')],
      [
        'ProviderHttpError 429',
        'RATE_LIMITED',
        new ProviderHttpError({ providerId: 'fake', status: 429, url: 'https://x.example/a' }),
      ],
      ['ProviderAuthRequiredError', 'AUTH_REQUIRED', new ProviderAuthRequiredError('fake')],
    ])('a %s becomes %s with its message', async (_name, code, thrown) => {
      register(contract.providers.list, () => {
        throw thrown;
      });

      await expect(ipc.invoke('providers:list', fakeEvent())).resolves.toEqual({
        success: false,
        code,
        error: thrown.message,
      });
      // Logged as a warning with the provider error's own code and retryability
      expect(warn).toHaveBeenCalledWith(
        `IPC providers:list failed: ${code} (${thrown.providerId} ${thrown.code}, retryable: ${thrown.retryable})`
      );
    });

    it('a ZodError thrown by the handler is VALIDATION with its paths', async () => {
      register(contract.watches.list, () => {
        z.object({ limit: z.number() }).parse({ limit: 'x' });
        return [];
      });

      await expect(ipc.invoke('watches:list', fakeEvent())).resolves.toMatchObject({
        code: 'VALIDATION',
        issues: ['limit'],
      });
    });
  });

  it('never puts a stack in the response', async () => {
    register(contract.watches.list, () => {
      throw new Error('boom');
    });

    const response = await ipc.invoke('watches:list', fakeEvent());

    expect(Object.keys(response as object).sort()).toEqual(['code', 'error', 'success']);
    expect(JSON.stringify(response)).not.toMatch(/\bat .*\.ts:\d+/);
  });

  it('a handler that rejects after its window closed still resolves (no unhandled rejection)', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      register(
        contract.watches.runNow,
        () =>
          new Promise((_resolve, reject) => setImmediate(() => reject(new Error('window gone'))))
      );

      const reply = ipc.invoke('watches:run-now', fakeEvent(), { id: 1 });
      await expect(reply).resolves.toMatchObject({ code: 'INTERNAL', error: 'window gone' });
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  describe('secret-safe logging', () => {
    it('logs the channel and issue paths of an invalid notifiers.configure, never the values', async () => {
      register(contract.notifiers.configure, jest.fn());

      await ipc.invoke('notifiers:configure', fakeEvent(), {
        channel: 'carrier-pigeon',
        displayName: 'Email (SMTP)',
        config: { auth: { user: 'me@example.com', pass: SECRET } },
        enabled: SECRET,
      });

      expect(logged()).toContain('notifiers:configure');
      expect(logged()).toContain('channel');
      expect(logged()).toContain('enabled');
      expect(logged()).not.toContain(SECRET);
      expect(logged()).not.toContain('carrier-pigeon');
      expect(logged()).not.toContain('me@example.com');
    });

    it('logs no payload values for account failures either, nor for one that fails validation', async () => {
      register(contract.accounts.openSignInLink, () => {
        throw new Error('disk full');
      });
      register(contract.accounts.signIn, jest.fn());

      await ipc.invoke('accounts:open-sign-in-link', fakeEvent(), {
        providerId: 'parkstay',
        url: `https://dbcab2c.b2clogin.com/link?token=${SECRET}&email=me@example.com`,
      });
      await ipc.invoke('accounts:sign-in', fakeEvent(), {
        providerId: 42,
        extra: SECRET,
      });

      expect(logged()).toContain('accounts:open-sign-in-link');
      expect(logged()).toContain('accounts:sign-in');
      expect(logged()).not.toContain(SECRET);
      expect(logged()).not.toContain('me@example.com');
    });

    it('logs a forbidden call by channel only', async () => {
      register(contract.notifiers.get, jest.fn());

      await ipc.invoke('notifiers:get', fakeEvent({ senderId: 5 }), {
        channel: NotifierChannel.EMAIL_SMTP,
      });

      expect(warn).toHaveBeenCalledWith('IPC notifiers:get rejected: untrusted sender');
    });
  });
});
