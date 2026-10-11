/**
 * The email notifier form (Settings → Notifications): its values, their checks, and the
 * `notifiers.configure` payload. The SMTP password is write-only (P5): the form starts with
 * none, and the payload carries one only when the person typed it, so a save without it keeps
 * the stored one (main allows that only for the same server and account).
 */
import { z } from 'zod';
import type { NotifierConfigureInput } from '../../../../../shared/contracts/notifiers';
import {
  NotifierChannel,
  SMTP_PRESETS,
  SMTPPreset,
  isSameSmtpAccount,
} from '../../../../../shared/types/notifier.types';
import type { EmailNotifierView } from '../../../../api';

export type Security = 'tls' | 'starttls';

export interface EmailFormValues {
  preset: SMTPPreset;
  host: string;
  /** As typed; checked to be 1–65535. */
  port: string;
  security: Security;
  /** The account the mail server signs in (an email address for Gmail and Outlook). */
  user: string;
  /** Only when the person enters one; never filled from what is stored. */
  password: string;
  fromEmail: string;
  toEmail: string;
}

export const PRESET_LABELS: Record<SMTPPreset, string> = {
  [SMTPPreset.GMAIL]: 'Gmail',
  [SMTPPreset.OUTLOOK]: 'Outlook',
  [SMTPPreset.CUSTOM]: 'Other mail server',
};

/** What the form starts with: the stored settings, without any password. */
export function emailFormDefaults(view: EmailNotifierView | null): EmailFormValues {
  const config = view?.config;
  const preset = config?.preset ?? SMTPPreset.GMAIL;
  const server = config ?? SMTP_PRESETS[preset];
  return {
    preset,
    host: server.host,
    port: String(server.port),
    security: server.secure ? 'tls' : 'starttls',
    user: config?.auth.user ?? '',
    password: '',
    fromEmail: config?.fromEmail ?? '',
    toEmail: config?.toEmail ?? '',
  };
}

/** The server a form's values send through: a preset's, or the custom one typed. */
export function serverOf(values: Pick<EmailFormValues, 'preset' | 'host' | 'port' | 'security'>) {
  if (values.preset !== SMTPPreset.CUSTOM) {
    const { host, port, secure } = SMTP_PRESETS[values.preset];
    return { host, port, secure };
  }
  return { host: values.host.trim(), port: Number(values.port), secure: values.security === 'tls' };
}

/**
 * Whether the stored password can be kept: one is stored, it could be read, and the server
 * and account are the ones it was saved for (`isSameSmtpAccount`, as main checks).
 */
export function canKeepPassword(view: EmailNotifierView | null, values: EmailFormValues): boolean {
  if (!view?.hasPassword || view.secretState === 'unreadable') return false;
  const { host, port } = serverOf(values);
  return isSameSmtpAccount(
    { host, port, auth: { user: values.user } },
    { host: view.config.host, port: view.config.port, auth: { user: view.config.auth.user } }
  );
}

/** A hint when the port and security usually go the other way (not an error: servers vary). */
export function securityHint(port: string, security: Security): string | undefined {
  if (port.trim() === '465' && security === 'starttls') return 'Port 465 usually uses SSL/TLS.';
  if (port.trim() === '587' && security === 'tls') return 'Port 587 usually uses STARTTLS.';
  return undefined;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailFormSchema({ passwordRequired }: { passwordRequired: boolean }) {
  return z
    .object({
      preset: z.enum(SMTPPreset),
      host: z.string(),
      port: z.string(),
      security: z.enum(['tls', 'starttls']),
      user: z.string().trim().min(1, 'Enter the account you sign in to your mail with'),
      password: z.string(),
      fromEmail: z.string().trim(),
      toEmail: z.string().trim(),
    })
    .superRefine((values, ctx) => {
      const issue = (path: keyof EmailFormValues, message: string) =>
        ctx.addIssue({ code: 'custom', path: [path], message });
      if (values.preset === SMTPPreset.CUSTOM) {
        if (!values.host.trim()) issue('host', 'Enter the mail server, such as smtp.example.com');
        const port = Number(values.port.trim());
        if (!/^\d+$/.test(values.port.trim()) || port < 1 || port > 65535) {
          issue('port', 'Enter a port from 1 to 65535');
        }
        if (values.fromEmail && !EMAIL.test(values.fromEmail)) {
          issue('fromEmail', 'Enter an email address, such as you@example.com');
        }
      }
      if (values.toEmail && !EMAIL.test(values.toEmail)) {
        issue('toEmail', 'Enter an email address, such as you@example.com');
      }
      if (passwordRequired && !values.password) issue('password', 'Enter the password');
    });
}

/**
 * The `notifiers.configure` payload. `password` is sent only when `sendPassword` is set and
 * one was typed; `enabled` is always sent, because main treats a missing one as off.
 */
export function toConfigureInput(
  values: EmailFormValues,
  { sendPassword, enabled }: { sendPassword: boolean; enabled: boolean }
): NotifierConfigureInput {
  const user = values.user.trim();
  const fromEmail = values.preset === SMTPPreset.CUSTOM ? values.fromEmail.trim() : '';
  const toEmail = values.toEmail.trim();
  return {
    channel: NotifierChannel.EMAIL_SMTP,
    displayName: 'Email',
    enabled,
    config: {
      preset: values.preset,
      ...serverOf(values),
      auth: sendPassword && values.password ? { user, pass: values.password } : { user },
      ...(fromEmail ? { fromEmail } : {}),
      ...(toEmail ? { toEmail } : {}),
    },
  };
}
