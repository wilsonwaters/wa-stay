/**
 * The SMTP password is write-only: a notifier view drops it and says `hasPassword`, and a
 * save without a password keeps the stored one, only for the same host, port and user.
 */

import {
  storedPassword,
  toNotifierView,
  withStoredPassword,
} from '@main/core/notifications/notifier-view';
import type { AppError } from '@main/utils/app-error';
import { Notifier, NotifierChannel, NotifierStatus, SMTPPreset } from '@shared/types';

const smtp = {
  preset: SMTPPreset.CUSTOM,
  host: 'smtp.example.com',
  port: 465,
  secure: true,
  auth: { user: 'me@example.com', pass: 'stored-secret' },
  fromEmail: 'from@example.com',
  toEmail: 'to@example.com',
};

function notifier(config: Notifier['config']): Notifier {
  return {
    id: 1,
    channel: NotifierChannel.EMAIL_SMTP,
    displayName: 'Email (SMTP)',
    enabled: true,
    config,
    status: NotifierStatus.CONFIGURED,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
  };
}

describe('toNotifierView', () => {
  it('removes auth.pass, keeps every other setting, and says hasPassword', () => {
    const view = toNotifierView(notifier(smtp));

    expect(view.config).toEqual({ ...smtp, auth: { user: 'me@example.com' } });
    expect(view.hasPassword).toBe(true);
    expect(JSON.stringify(view)).not.toContain('stored-secret');
    expect(view).toMatchObject({ id: 1, channel: 'email_smtp', enabled: true });
  });

  it('hasPassword is false for an empty, missing or undecryptable config', () => {
    expect(toNotifierView(notifier({ ...smtp, auth: { user: 'me', pass: '' } })).hasPassword).toBe(
      false
    );
    expect(toNotifierView(notifier({})).hasPassword).toBe(false);
    expect(toNotifierView(notifier({})).config).toEqual({});
  });
});

describe('withStoredPassword', () => {
  const { pass: _ignored, ...auth } = smtp.auth;
  void _ignored;
  const blank = { ...auth, pass: '' };

  /** The VALIDATION error `withStoredPassword` throws, or undefined. */
  function rejection(run: () => unknown): { code: string; message: string } | undefined {
    try {
      run();
      return undefined;
    } catch (error) {
      return { code: (error as AppError).code, message: (error as Error).message };
    }
  }

  it('same host, port and user without a password keeps the stored one', () => {
    const changed = { ...smtp, secure: false, toEmail: 'other@example.com', auth: blank };
    expect(withStoredPassword(changed, smtp)).toEqual({
      ...changed,
      auth: { user: 'me@example.com', pass: 'stored-secret' },
    });
    expect(withStoredPassword({ ...smtp, auth }, smtp).auth.pass).toBe('stored-secret');
    // Host case and surrounding spaces are not a change of server
    expect(withStoredPassword({ ...smtp, host: ' SMTP.Example.com ', auth }, smtp).auth.pass).toBe(
      'stored-secret'
    );
  });

  it.each([
    ['host', { host: 'smtp.attacker.example' }],
    ['port', { port: 2525 }],
    ['user', { auth: { user: 'someone-else@example.com' } }],
  ])('a %s change without a password is rejected: the stored one is not reused', (_, change) => {
    const config = { ...smtp, auth, ...change };
    expect(rejection(() => withStoredPassword(config, smtp))).toEqual({
      code: 'VALIDATION',
      message: 'Enter the password for the new server/account',
    });
    expect(
      rejection(() => withStoredPassword({ ...config, auth: { ...config.auth, pass: '' } }, smtp))
    ).toEqual({ code: 'VALIDATION', message: 'Enter the password for the new server/account' });
  });

  it('a host change with a password stores the new password', () => {
    const moved = { ...smtp, host: 'smtp.other.example', auth: { ...auth, pass: 'new' } };
    expect(withStoredPassword(moved, smtp)).toEqual({
      ...moved,
      auth: { user: 'me@example.com', pass: 'new' },
    });
    expect(withStoredPassword({ ...smtp, auth: { ...auth, pass: 'new' } }, smtp).auth.pass).toBe(
      'new'
    );
  });

  it('with no stored password (or no stored server) and none given, it is rejected', () => {
    const required = { code: 'VALIDATION', message: 'A password is required' };
    expect(rejection(() => withStoredPassword({ ...smtp, auth }, undefined))).toEqual(required);
    expect(rejection(() => withStoredPassword({ ...smtp, auth }, {}))).toEqual(required);
    expect(
      rejection(() => withStoredPassword({ ...smtp, auth }, { auth: { pass: 'orphan' } }))
    ).toEqual({ code: 'VALIDATION', message: 'Enter the password for the new server/account' });
    expect(
      withStoredPassword({ ...smtp, auth: { ...auth, pass: 'new' } }, undefined).auth.pass
    ).toBe('new');
    expect(storedPassword({ auth: { pass: 42 } })).toBe('');
  });
});
