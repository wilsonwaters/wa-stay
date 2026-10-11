import { emailNotifier } from '@tests/fixtures/renderer/settings';
import { NotifierChannel, SMTPPreset } from '../../../../../shared/types/notifier.types';
import {
  canKeepPassword,
  emailFormDefaults,
  emailFormSchema,
  securityHint,
  toConfigureInput,
  type EmailFormValues,
} from './emailForm';

const GMAIL: EmailFormValues = {
  preset: SMTPPreset.GMAIL,
  host: 'smtp.gmail.com',
  port: '587',
  security: 'starttls',
  user: 'ann@example.com',
  password: '',
  fromEmail: '',
  toEmail: '',
};

describe('emailFormDefaults', () => {
  it('starts from the stored settings, never with a password', () => {
    expect(
      emailFormDefaults(
        emailNotifier({ config: { ...emailNotifier().config, toEmail: 'me@x.au' } })
      )
    ).toEqual({ ...GMAIL, toEmail: 'me@x.au' });
  });

  it('with nothing stored, starts on Gmail', () => {
    expect(emailFormDefaults(null)).toEqual({ ...GMAIL, user: '' });
  });
});

describe('toConfigureInput', () => {
  it('omits the password unless one was entered, and always sends enabled', () => {
    const kept = toConfigureInput(
      { ...GMAIL, password: 'ignored' },
      { sendPassword: false, enabled: true }
    );
    expect(kept).toEqual({
      channel: NotifierChannel.EMAIL_SMTP,
      displayName: 'Email',
      enabled: true,
      config: {
        preset: SMTPPreset.GMAIL,
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user: 'ann@example.com' },
      },
    });
    expect(JSON.stringify(kept)).not.toContain('ignored');

    expect(
      toConfigureInput({ ...GMAIL, password: 'abcd efgh' }, { sendPassword: true, enabled: false })
    ).toMatchObject({
      enabled: false,
      config: { auth: { user: 'ann@example.com', pass: 'abcd efgh' } },
    });
    // Entry mode with nothing typed still sends no password
    expect(toConfigureInput(GMAIL, { sendPassword: true, enabled: true }).config.auth).toEqual({
      user: 'ann@example.com',
    });
  });

  it('a preset sends its own server; a custom server sends what was typed, with from and to', () => {
    expect(
      toConfigureInput(
        { ...GMAIL, preset: SMTPPreset.OUTLOOK, host: 'typed.example.com', fromEmail: 'x@y.au' },
        { sendPassword: false, enabled: true }
      ).config
    ).toEqual({
      preset: SMTPPreset.OUTLOOK,
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      auth: { user: 'ann@example.com' },
    });

    expect(
      toConfigureInput(
        {
          ...GMAIL,
          preset: SMTPPreset.CUSTOM,
          host: ' mail.example.com ',
          port: '465',
          security: 'tls',
          user: 'ann',
          fromEmail: 'ann@example.com',
          toEmail: 'alerts@example.com',
        },
        { sendPassword: false, enabled: true }
      ).config
    ).toEqual({
      preset: SMTPPreset.CUSTOM,
      host: 'mail.example.com',
      port: 465,
      secure: true,
      auth: { user: 'ann' },
      fromEmail: 'ann@example.com',
      toEmail: 'alerts@example.com',
    });
  });
});

describe('canKeepPassword', () => {
  it('only for the stored server and account, with a readable password', () => {
    expect(canKeepPassword(emailNotifier(), GMAIL)).toBe(true);
    expect(canKeepPassword(emailNotifier(), { ...GMAIL, user: 'bob@example.com' })).toBe(false);
    expect(canKeepPassword(emailNotifier(), { ...GMAIL, preset: SMTPPreset.OUTLOOK })).toBe(false);
    expect(canKeepPassword(emailNotifier({ hasPassword: false }), GMAIL)).toBe(false);
    expect(canKeepPassword(emailNotifier({ secretState: 'unreadable' }), GMAIL)).toBe(false);
    expect(canKeepPassword(null, GMAIL)).toBe(false);
  });
});

describe('emailFormSchema', () => {
  const errors = (values: EmailFormValues, passwordRequired = false) => {
    const result = emailFormSchema({ passwordRequired }).safeParse(values);
    return result.success
      ? {}
      : Object.fromEntries(result.error.issues.map((i) => [i.path[0], i.message]));
  };

  it('a custom port must be 1–65535', () => {
    const custom = { ...GMAIL, preset: SMTPPreset.CUSTOM, host: 'mail.example.com' };
    for (const port of ['0', '65536', 'abc', '']) {
      expect(errors({ ...custom, port })).toEqual({ port: 'Enter a port from 1 to 65535' });
    }
    expect(errors({ ...custom, port: '2525' })).toEqual({});
  });

  it('asks for the account, the custom server and a password when one is needed', () => {
    expect(errors({ ...GMAIL, user: ' ' }, true)).toEqual({
      user: 'Enter the account you sign in to your mail with',
      password: 'Enter the password',
    });
    expect(errors({ ...GMAIL, preset: SMTPPreset.CUSTOM, host: '' })).toEqual({
      host: 'Enter the mail server, such as smtp.example.com',
    });
    expect(errors({ ...GMAIL, toEmail: 'not an email' })).toEqual({
      toEmail: 'Enter an email address, such as you@example.com',
    });
  });
});

describe('securityHint', () => {
  it('hints when the port and security usually go the other way', () => {
    expect(securityHint('465', 'starttls')).toBe('Port 465 usually uses SSL/TLS.');
    expect(securityHint('587', 'tls')).toBe('Port 587 usually uses STARTTLS.');
    expect(securityHint('465', 'tls')).toBeUndefined();
    expect(securityHint('2525', 'starttls')).toBeUndefined();
  });
});
