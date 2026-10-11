/**
 * Logger (Winston).
 *
 * At import the logger has only a console transport, so nothing is written to disk before
 * the app knows its final data folder, and Jest never writes log files. After `ready`,
 * `index.ts` calls `initFileLogging(<userData>/logs)`, which adds the rotating log files.
 *
 * `exitOnError: false`: logging never ends the process. Uncaught exceptions and unhandled
 * rejections belong to the crash policy (`app/crash-policy.ts`), which logs them with a
 * `crash` field; the `exceptions.log` and `rejections.log` transports keep only those
 * records. Winston's own exception and rejection handlers are not used: with
 * `exitOnError: false` they end their file stream after the first exception, and the
 * second exception then kills the process ("write after end").
 *
 * Modules log through a child logger, which tags every line with the module name:
 * `const log = logger.child({ module: 'scheduler' })`.
 */

import fs from 'fs';
import path from 'path';
import winston from 'winston';

/** The `crash` field the crash policy puts on uncaught exceptions and unhandled rejections. */
export type CrashKind = 'exception' | 'rejection';

const MB = 1024 * 1024;

/**
 * What `log.error('… failed:', value)` records, made safe and readable.
 *
 * - An HTTP client's error (axios, gaxios) carries the whole exchange: headers with session
 *   cookies or bearer tokens, and bodies with passwords, refresh tokens or client secrets.
 *   Logging it copies its fields into the record, so the exchange fields (`config`,
 *   `request`, `response`) are dropped wherever they appear.
 * - Every other value is copied with secrets redacted by key name, at any depth: in the
 *   record, in nested objects and arrays, and in errors (their own fields and `cause`). An
 *   error nested in the record keeps its name, message, code and stack. A copy is at most
 *   `MAX_DEPTH` levels deep, and a circular reference is logged as `[Circular]`.
 * - `splat()` merges the logged values into the record a second time, so it is given the
 *   same safe copies. An error's message and stack are already in the record ("… failed:
 *   <message>"); the copy leaves them out so the prefix is kept.
 * - A string or number logged after the message is appended to it, the way the console
 *   printed it (`splat()` would spread a string into one field per character).
 *
 * Redaction is by key only: a secret inside a string (a message, a raw body) is not found,
 * so never put one in a message.
 */
const HTTP_EXCHANGE_FIELDS = ['config', 'request', 'response'];
const SPLAT = Symbol.for('splat');
const FORMAT_TOKEN = /%[scdjifoO%]/;
const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;

/** Secret keys, compared case-insensitively and ignoring `-` and `_` (`set-cookie`, `clientSecret`). */
const SECRET_KEYS = new Set([
  'authorization',
  'cookie',
  'setcookie',
  'password',
  'pass',
  'passwd',
  'secret',
  'clientsecret',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'codeverifier',
  'sessionkey',
]);

/** Whether a field with this name holds a secret: a `SECRET_KEYS` name or `*_token`. */
export function isSecretKey(key: string): boolean {
  return (
    SECRET_KEYS.has(key.toLowerCase().replace(/[-_]/g, '')) ||
    /(?:^|[-_])token$/i.test(key) ||
    /[a-z\d]Token$/.test(key)
  );
}

const safeRecord = winston.format((info) => {
  const record = info as typeof info & { [SPLAT]?: unknown };
  for (const [key, value] of Object.entries(record)) {
    if (HTTP_EXCHANGE_FIELDS.includes(key)) delete record[key];
    else if (isSecretKey(key)) record[key] = REDACTED;
    else record[key] = redact(value, 1, new Set());
  }
  const values = record[SPLAT];
  if (!Array.isArray(values)) return record;

  // With `%s`-style tokens, `splat()` interpolates the values into the message instead
  const interpolated = typeof record.message === 'string' && FORMAT_TOKEN.test(record.message);
  const merged: unknown[] = [];
  for (const value of values) {
    if (value instanceof Error) {
      merged.push(errorFields(value, 1, new Set([value]), ['message', 'stack']));
    } else if (typeof value === 'object' && value !== null) {
      const safe = redact(value, 1, new Set());
      if (interpolated || (typeof safe === 'object' && safe !== null)) merged.push(safe);
      else if (safe !== undefined) record.message = `${record.message} ${String(safe)}`;
    } else if (interpolated) merged.push(value);
    else if (value !== undefined && value !== null) record.message = `${record.message} ${value}`;
  }
  record[SPLAT] = merged;
  return record;
});

/**
 * A copy of `value` that is safe to log. `ancestors` are the objects being copied above it,
 * so a reference back to one of them is a cycle (a shared, non-circular object is not).
 */
function redact(value: unknown, depth: number, ancestors: Set<object>): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (ancestors.has(value)) return '[Circular]';
  if (depth > MAX_DEPTH) return '[Truncated]';

  ancestors.add(value);
  try {
    if (value instanceof Error) return summarizeError(value, depth, ancestors);
    if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, ancestors));
    const { toJSON } = value as { toJSON?: unknown };
    // What JSON would print (a Date's ISO string, a Buffer's bytes), made safe the same way
    if (typeof toJSON === 'function') return redact(toJSON.call(value), depth + 1, ancestors);
    return redactFields(value, depth, ancestors);
  } catch {
    return '[Unserializable]';
  } finally {
    ancestors.delete(value);
  }
}

/** Own enumerable fields: exchange fields dropped, secrets redacted, the rest copied. */
function redactFields(
  source: object,
  depth: number,
  ancestors: Set<object>,
  skip: string[] = []
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (HTTP_EXCHANGE_FIELDS.includes(key) || skip.includes(key)) continue;
    fields[key] = isSecretKey(key) ? REDACTED : redact(value, depth + 1, ancestors);
  }
  return fields;
}

/** An error's own fields and code, and its `cause` (often not enumerable), made safe. */
function errorFields(
  error: Error & { code?: unknown },
  depth: number,
  ancestors: Set<object>,
  skip: string[] = []
): Record<string, unknown> {
  const fields = redactFields(error, depth, ancestors, skip);
  if (error.code !== undefined && !('code' in fields)) fields.code = error.code;
  if (error.cause !== undefined) fields.cause = redact(error.cause, depth + 1, ancestors);
  return fields;
}

function summarizeError(
  error: Error & { code?: unknown },
  depth: number,
  ancestors: Set<object>
): Record<string, unknown> {
  const { cause, ...fields } = errorFields(error, depth, ancestors, ['name', 'message', 'stack']);
  return {
    name: error.name,
    message: error.message,
    ...fields,
    stack: error.stack,
    ...(cause !== undefined ? { cause } : {}),
  };
}

// Define log format. `errors()` first turns a logged Error into a plain record (a copy, so
// the caller's error is never changed); `safeRecord()` then runs before `splat()`.
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  safeRecord(),
  winston.format.splat(),
  winston.format.json()
);

// Console format: `12:00:00 [info] [scheduler]: message {meta}`
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, module, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    const moduleStr = module ? ` [${module}]` : '';
    return `${timestamp} [${level}]${moduleStr}: ${message} ${metaStr}`;
  })
);

// Create logger instance: console only until initFileLogging
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  exitOnError: false,
  transports: [new winston.transports.Console({ format: consoleFormat })],
});

let fileLogsDir: string | null = null;
let fileTransports: winston.transport[] = [];
let fileLoggingFailed = false;

/** Keeps only the crash policy's records of one kind. */
const onlyCrash = (kind: CrashKind): winston.Logform.Format =>
  winston.format((info) => (info.crash === kind ? info : false))();

function createFileTransports(dir: string): winston.transport[] {
  return [
    new winston.transports.File({
      filename: path.join(dir, 'error.log'),
      level: 'error',
      maxsize: 5 * MB,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(dir, 'combined.log'),
      maxsize: 5 * MB,
      maxFiles: 10,
    }),
    new winston.transports.File({
      filename: path.join(dir, 'exceptions.log'),
      level: 'error',
      format: onlyCrash('exception'),
      maxsize: 5 * MB,
      maxFiles: 3,
    }),
    new winston.transports.File({
      filename: path.join(dir, 'rejections.log'),
      level: 'error',
      format: onlyCrash('rejection'),
      maxsize: 5 * MB,
      maxFiles: 3,
    }),
  ];
}

/** Warns once (on the console) and stays on console logging. */
function disableFileLogging(dir: string, error: unknown): void {
  for (const transport of fileTransports) transport.silent = true;
  if (fileLoggingFailed) return;
  fileLoggingFailed = true;
  const reason = error instanceof Error ? error.message : String(error);
  logger.warn(`Log files disabled; logging to the console only (${dir}: ${reason})`);
}

// A failing log file (disk full, folder removed) must never crash the app.
logger.on('error', (error: unknown) => disableFileLogging(fileLogsDir ?? '', error));

/**
 * Adds the rotating log files (`combined.log`, `error.log`, `exceptions.log`,
 * `rejections.log`) under `dir`, creating it if needed, and returns `dir`. Call it after
 * `ready`, once the data folder is final. If `dir` is not writable it warns once and the
 * logger stays on the console; it never throws. A second call changes nothing.
 */
export function initFileLogging(dir: string): string {
  if (fileLogsDir !== null) return fileLogsDir;

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.closeSync(fs.openSync(path.join(dir, 'combined.log'), 'a'));
  } catch (error) {
    disableFileLogging(dir, error);
    return dir;
  }

  fileLogsDir = dir;
  fileTransports = createFileTransports(dir);
  for (const transport of fileTransports) logger.add(transport);
  return dir;
}

// Export logger methods for convenience
export const logInfo = (message: string, meta?: any) => logger.info(message, meta);
export const logError = (message: string, error?: Error | any) => {
  if (error instanceof Error) {
    logger.error(message, { error: error.message, stack: error.stack });
  } else {
    logger.error(message, error);
  }
};
export const logWarn = (message: string, meta?: any) => logger.warn(message, meta);
export const logDebug = (message: string, meta?: any) => logger.debug(message, meta);

export default logger;
