/**
 * The SMTP password is write-only (architecture-notes §4, §7): what IPC returns for a
 * notifier never contains it, and saving settings without a password keeps the stored one,
 * but only for the server and account it was saved for.
 */

import {
  isSameSmtpAccount,
  SMTP_NEW_ACCOUNT_PASSWORD,
  type Notifier,
  type NotifierView,
  type SMTPAccount,
  type SMTPConfig,
} from '@shared/types';
import type { NotifierConfigureInput } from '@shared/contracts/notifiers';
import { AppError } from '../../utils/app-error';

type Config = Record<string, unknown>;

function isRecord(value: unknown): value is Config {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The password stored in a notifier config (`config.auth.pass`), or ''. */
export function storedPassword(config: unknown): string {
  if (!isRecord(config) || !isRecord(config.auth)) return '';
  return typeof config.auth.pass === 'string' ? config.auth.pass : '';
}

/** The server and account a stored notifier config is for, or null when it has none. */
function storedAccount(config: unknown): SMTPAccount | null {
  if (!isRecord(config) || !isRecord(config.auth)) return null;
  const { host, port } = config;
  const { user } = config.auth;
  if (typeof host !== 'string' || typeof port !== 'number' || typeof user !== 'string') {
    return null;
  }
  return { host, port, auth: { user } };
}

/** A notifier as the renderer may see it: `config.auth.pass` removed, `hasPassword` added. */
export function toNotifierView(notifier: Notifier): NotifierView {
  const config = notifier.config as Config;
  const viewConfig: Config = { ...config };
  if (isRecord(config.auth)) {
    viewConfig.auth = Object.fromEntries(
      Object.entries(config.auth).filter(([key]) => key !== 'pass')
    );
  }
  return { ...notifier, config: viewConfig, hasPassword: storedPassword(config) !== '' };
}

/**
 * The SMTP config to store. A password the renderer sent (non-empty) is stored as given.
 * Without one, the stored password is kept only when host, port and `auth.user` are
 * unchanged: a renderer cannot point the stored password at another server or account.
 *
 * Throws `AppError('VALIDATION')` when there is no password to keep, or when the server or
 * account changed and no new password was sent.
 */
export function withStoredPassword(
  config: NotifierConfigureInput['config'],
  storedConfig: unknown
): SMTPConfig {
  const user = config.auth.user;
  if (config.auth.pass) return { ...config, auth: { user, pass: config.auth.pass } };

  const pass = storedPassword(storedConfig);
  if (!pass) throw new AppError('VALIDATION', 'A password is required');

  const account = storedAccount(storedConfig);
  if (!account || !isSameSmtpAccount(config, account)) {
    throw new AppError('VALIDATION', SMTP_NEW_ACCOUNT_PASSWORD);
  }
  return { ...config, auth: { user, pass } };
}
