/**
 * The logger writes nothing to disk until `initFileLogging(dir)`, then writes the rotating
 * log files under `dir` (crash records also to exceptions.log / rejections.log). An
 * unwritable folder, or a log file failing later, warns once and leaves console logging.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { AxiosError } from 'axios';
import winston from 'winston';

type LoggerModule = typeof import('@main/utils/logger');

/**
 * A fresh copy of the logger module (it keeps module state). Winston loads its transport
 * classes lazily, so they are compared by name, not with instanceof.
 */
function loadLogger(): LoggerModule {
  let loaded: LoggerModule | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual('@main/utils/logger') as LoggerModule;
  });
  return loaded as LoggerModule;
}

const kind = (transport: winston.transport): string => transport.constructor.name;

async function waitForFile(file: string, predicate: (text: string) => boolean): Promise<string> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (predicate(text)) return text;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${file}: ${text}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function lines(text: string): Array<Record<string, unknown>> {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Every file under `dir` with its size and mtime, or [] when it does not exist. */
function snapshot(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).map((name) => {
    const stat = fs.statSync(path.join(dir, String(name)));
    return `${String(name)} ${stat.size} ${stat.mtimeMs}`;
  });
}

const LEGACY_TEMP_LOGS = path.join(os.tmpdir(), 'parkstay-bookings');

describe('logger', () => {
  const opened: winston.Logger[] = [];
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-logs-'));
  });

  afterEach(async () => {
    opened.splice(0).forEach((logger) => logger.close());
    // Async with retries: Windows refuses to delete a log file until its transport has
    // closed it, which happens on a later tick.
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    jest.restoreAllMocks();
  });

  /** Keeps test output clean: the console transport is the only one at import. */
  function silenceConsole({ logger }: LoggerModule): void {
    for (const transport of logger.transports) {
      if (kind(transport) === 'Console') transport.silent = true;
    }
  }

  /**
   * What the console transport prints (its own format, after the logger's). It binds
   * console.log when it is created, so its own output hooks are replaced.
   */
  function captureConsole({ logger }: LoggerModule): string[] {
    const consoleLines: string[] = [];
    for (const transport of logger.transports) {
      if (kind(transport) !== 'Console') continue;
      const print = (line: string): void => void consoleLines.push(line);
      Object.assign(transport, { _consoleLog: print, _consoleWarn: print, _consoleError: print });
      Object.assign(transport, { forceConsole: true, silent: false });
    }
    return consoleLines;
  }

  it('at import has only a console transport, never exits on error, and writes no files', () => {
    const before = snapshot(LEGACY_TEMP_LOGS);
    const loaded = loadLogger();
    const { logger } = loaded;
    opened.push(logger);
    silenceConsole(loaded);

    logger.error('logged before ready');

    expect(logger.transports.map(kind)).toEqual(['Console']);
    expect(logger.transports.map(kind)).toEqual(['Console']);
    expect(logger.exitOnError).toBe(false);
    expect(snapshot(LEGACY_TEMP_LOGS)).toEqual(before);
  });

  it('initFileLogging returns the folder and writes the log files there', async () => {
    const before = snapshot(LEGACY_TEMP_LOGS);
    const loaded = loadLogger();
    const { logger, initFileLogging } = loaded;
    opened.push(logger);
    silenceConsole(loaded);
    const logsDir = path.join(dir, 'userData', 'logs');

    expect(initFileLogging(logsDir)).toBe(logsDir);
    expect(initFileLogging(path.join(dir, 'elsewhere'))).toBe(logsDir); // a second call changes nothing

    logger.warn('Initializing application...');
    logger.child({ module: 'scheduler' }).error('Error executing watch 3');
    logger.error('Uncaught exception: boom', { crash: 'exception', stack: 'Error: boom\n  at x' });
    logger.error('Unhandled promise rejection: nope', { crash: 'rejection' });

    const combined = lines(
      await waitForFile(path.join(logsDir, 'combined.log'), (t) => t.includes('nope'))
    );
    expect(combined.map((line) => line.message)).toEqual([
      'Initializing application...',
      'Error executing watch 3',
      'Uncaught exception: boom',
      'Unhandled promise rejection: nope',
    ]);
    expect(combined[1]).toMatchObject({ level: 'error', module: 'scheduler' });

    const errors = lines(
      await waitForFile(path.join(logsDir, 'error.log'), (t) => t.includes('nope'))
    );
    expect(errors).toHaveLength(3);

    const exceptions = lines(
      await waitForFile(path.join(logsDir, 'exceptions.log'), (t) => t.includes('boom'))
    );
    expect(exceptions).toEqual([
      expect.objectContaining({
        message: 'Uncaught exception: boom',
        stack: 'Error: boom\n  at x',
      }),
    ]);
    const rejections = lines(
      await waitForFile(path.join(logsDir, 'rejections.log'), (t) => t.includes('nope'))
    );
    expect(rejections.map((line) => line.message)).toEqual(['Unhandled promise rejection: nope']);

    expect(snapshot(LEGACY_TEMP_LOGS)).toEqual(before);
  });

  it("an HTTP client's error is logged without its request, response, headers or body", async () => {
    const loaded = loadLogger();
    const { logger, initFileLogging } = loaded;
    opened.push(logger);
    silenceConsole(loaded);
    const logsDir = path.join(dir, 'logs');
    initFileLogging(logsDir);
    const consoleLines = captureConsole(loaded);

    // axios: what ParkStay calls throw (every request carries the session cookies)
    const axiosError = new AxiosError(
      'Request failed with status code 500',
      'ERR_BAD_RESPONSE',
      {
        headers: { Cookie: 'sessionid=SECRET-SESSION; csrftoken=SECRET-CSRF' },
        data: '{"password":"SECRET-PASSWORD"}',
      } as never,
      { path: '/api/x', headers: { cookie: 'sessionid=SECRET-SESSION' } },
      { status: 500, statusText: '', headers: {}, data: 'SECRET-BODY', config: {} } as never
    );
    // gaxios: what a Gmail token refresh throws (its body has the client secret)
    const gaxiosLike = Object.assign(new Error('invalid_grant'), {
      config: { headers: { Authorization: 'Bearer SECRET-TOKEN' }, data: 'SECRET-CLIENT' },
      response: { data: 'SECRET-BODY' },
      error: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    });

    logger.child({ module: 'parkstay' }).error('Check availability failed:', axiosError);
    logger.error('Failed to refresh access token:', gaxiosLike);
    logger.warn('Wrapped', { cause: axiosError });

    const text = await waitForFile(path.join(logsDir, 'combined.log'), (t) =>
      t.includes('Wrapped')
    );
    const [parkstay, gmail, wrapped] = lines(text);
    expect(parkstay).toMatchObject({
      level: 'error',
      module: 'parkstay',
      message: 'Check availability failed: Request failed with status code 500',
      code: 'ERR_BAD_RESPONSE',
    });
    expect(parkstay).not.toHaveProperty('config');
    expect(parkstay).not.toHaveProperty('request');
    expect(parkstay).not.toHaveProperty('response');
    expect(gmail).toMatchObject({
      message: 'Failed to refresh access token: invalid_grant',
      error: { name: 'Error', message: 'socket hang up', code: 'ECONNRESET' },
    });
    expect(wrapped.cause).toMatchObject({
      name: 'AxiosError',
      message: 'Request failed with status code 500',
      code: 'ERR_BAD_RESPONSE',
    });
    expect(wrapped.cause).not.toHaveProperty('config');

    for (const output of [text, consoleLines.join('\n')]) {
      expect(output).not.toMatch(/SECRET-/);
    }
    expect(consoleLines).toHaveLength(3);
  });

  it('secrets are redacted by key at any depth: responses, nested headers, error fields, cycles', async () => {
    const loaded = loadLogger();
    const { logger, initFileLogging } = loaded;
    opened.push(logger);
    silenceConsole(loaded);
    const logsDir = path.join(dir, 'logs');
    initFileLogging(logsDir);
    const consoleLines = captureConsole(loaded);

    // A plain response object: a session cookie in its headers, tokens in its body
    logger.warn('Sign-in rejected:', {
      status: 403,
      headers: {
        'Set-Cookie': ['sessionid=SECRET-SESSION; HttpOnly'],
        'content-type': 'application/json',
      },
      data: {
        detail: 'Invalid credentials',
        access_token: 'SECRET-ACCESS',
        session: { refreshToken: 'SECRET-REFRESH', expires_in: 3600 },
      },
    });
    // An exchange nested below the record, and a bare header block
    logger.warn('Nested', {
      detail: {
        config: { headers: { Authorization: 'Bearer SECRET-BEARER' }, data: 'SECRET-BODY' },
        headers: { Authorization: 'Bearer SECRET-BEARER', COOKIE: 'csrftoken=SECRET-CSRF' },
        response: { data: 'SECRET-BODY' },
        step: 'otp',
      },
    });
    // An error with a custom secret field, logged directly and as a cause
    const signInError = Object.assign(new Error('Bad credentials'), {
      username: 'me@example.com',
      password: 'SECRET-PASSWORD',
      code: 'E_AUTH',
    });
    logger.error('Sign-in failed:', signInError);
    logger.warn('Retry gave up', {
      cause: new Error('Retries exhausted', { cause: signInError }),
    });
    // A circular object, and an error that is its own cause
    const loop: Record<string, unknown> = { name: 'loop', sessionKey: 'SECRET-KEY' };
    loop.self = loop;
    loop.list = [loop, { client_secret: 'SECRET-CLIENT' }];
    const selfCaused = Object.assign(new Error('Self caused'), { session_key: 'SECRET-KEY' });
    Object.assign(selfCaused, { cause: selfCaused });
    logger.warn('Circular', { loop, selfCaused });
    // Every key spelling, and fields that only look like secrets
    logger.warn('Keys', {
      Authorization: 'SECRET-1',
      cookie: 'SECRET-2',
      pass: 'SECRET-3',
      passwd: 'SECRET-4',
      secret: 'SECRET-5',
      clientSecret: 'SECRET-6',
      id_token: 'SECRET-7',
      csrf_token: 'SECRET-8',
      code_verifier: 'SECRET-9',
      sessionkey: 'SECRET-10',
      accessToken: 'SECRET-11',
      hasPassword: true,
      tokenType: 'Bearer',
    });
    let deep: Record<string, unknown> = { password: 'SECRET-DEEP' };
    for (let i = 0; i < 20; i++) deep = { level: deep };
    logger.warn('Deep', deep);

    const text = await waitForFile(path.join(logsDir, 'combined.log'), (t) => t.includes('Deep'));
    const [response, nested, signIn, retry, circular, keys, deepLine] = lines(text);

    expect(response).toMatchObject({
      message: 'Sign-in rejected:',
      status: 403,
      headers: { 'Set-Cookie': '[REDACTED]', 'content-type': 'application/json' },
      data: {
        detail: 'Invalid credentials',
        access_token: '[REDACTED]',
        session: { refreshToken: '[REDACTED]', expires_in: 3600 },
      },
    });
    expect(nested).toEqual(
      expect.objectContaining({
        detail: {
          headers: { Authorization: '[REDACTED]', COOKIE: '[REDACTED]' },
          step: 'otp',
        },
      })
    );
    expect(signIn).toMatchObject({
      message: 'Sign-in failed: Bad credentials',
      username: 'me@example.com',
      password: '[REDACTED]',
      code: 'E_AUTH',
    });
    expect(retry.cause).toMatchObject({
      name: 'Error',
      message: 'Retries exhausted',
      cause: {
        message: 'Bad credentials',
        username: 'me@example.com',
        password: '[REDACTED]',
        code: 'E_AUTH',
      },
    });
    expect(circular).toMatchObject({
      loop: {
        name: 'loop',
        sessionKey: '[REDACTED]',
        self: '[Circular]',
        list: ['[Circular]', { client_secret: '[REDACTED]' }],
      },
      selfCaused: { message: 'Self caused', session_key: '[REDACTED]', cause: '[Circular]' },
    });
    expect(keys).toMatchObject({ hasPassword: true, tokenType: 'Bearer' });
    for (let i = 1; i <= 11; i++) expect(Object.values(keys)).not.toContain(`SECRET-${i}`);
    expect(JSON.stringify(deepLine)).toContain('[Truncated]');

    for (const output of [text, consoleLines.join('\n')]) {
      expect(output).not.toMatch(/SECRET-/);
    }
    expect(consoleLines).toHaveLength(7);
  });

  it('a string or number logged after the message is appended to it, as console.error printed it', async () => {
    const loaded = loadLogger();
    const { logger, initFileLogging } = loaded;
    opened.push(logger);
    silenceConsole(loaded);
    const logsDir = path.join(dir, 'logs');
    initFileLogging(logsDir);

    logger.error('Failed to send notification via email_smtp:', 'Connection timeout');
    logger.child({ module: 'parkstay' }).error('Failed to fetch campsite name:', 404);
    // (warn: tests run the logger at LOG_LEVEL=warn)
    logger.warn('Notifier email_smtp configured', { enabled: true });
    logger.warn('Nothing else', undefined);

    const text = await waitForFile(path.join(logsDir, 'combined.log'), (t) =>
      t.includes('Nothing else')
    );
    const [smtp, parkstay, configured, plain] = lines(text);
    expect(smtp.message).toBe('Failed to send notification via email_smtp: Connection timeout');
    expect(smtp).not.toHaveProperty('0');
    expect(parkstay).toMatchObject({
      module: 'parkstay',
      message: 'Failed to fetch campsite name: 404',
    });
    expect(configured).toMatchObject({ message: 'Notifier email_smtp configured', enabled: true });
    expect(plain.message).toBe('Nothing else');
  });

  it('an unwritable folder warns once and stays on the console without throwing', () => {
    const loaded = loadLogger();
    const { logger, initFileLogging } = loaded;
    opened.push(logger);
    silenceConsole(loaded);
    const warn = jest.spyOn(logger, 'warn');
    const blocker = path.join(dir, 'not-a-folder');
    fs.writeFileSync(blocker, '');
    const logsDir = path.join(blocker, 'logs');

    expect(() => initFileLogging(logsDir)).not.toThrow();
    expect(initFileLogging(logsDir)).toBe(logsDir);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^Log files disabled; logging to the console only/);
    expect(logger.transports.map(kind)).toEqual(['Console']);
    expect(() => logger.error('still logging')).not.toThrow();
  });

  it('a log file failing later (disk full) never throws: file logging stops, with one warning', () => {
    const loaded = loadLogger();
    const { logger, initFileLogging } = loaded;
    opened.push(logger);
    silenceConsole(loaded);
    initFileLogging(path.join(dir, 'logs'));
    const warn = jest.spyOn(logger, 'warn');
    const files = logger.transports.filter((t) => kind(t) === 'File');
    expect(files).toHaveLength(4);

    expect(() =>
      files[1].emit('error', new Error('ENOSPC: no space left on device'))
    ).not.toThrow();
    expect(() =>
      files[0].emit('error', new Error('ENOSPC: no space left on device'))
    ).not.toThrow();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(files.every((transport) => transport.silent)).toBe(true);
  });
});
