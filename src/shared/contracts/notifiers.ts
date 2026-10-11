/**
 * `notifiers`: outbound notification channels (email SMTP). The SMTP password is
 * write-only: responses are `NotifierView`s without it (`hasPassword` instead), and
 * `configure` with an empty or absent `config.auth.pass` keeps the stored password, only
 * when host, port and `auth.user` are unchanged (otherwise `VALIDATION`).
 */

import { z } from 'zod';
import { NotifierChannel, SMTPPreset } from '../types/notifier.types';
import type { NotifierView, TestConnectionResult } from '../types/notifier.types';
import { CHANNELS } from './channels';
import type { Namespace } from './define';

const C = CHANNELS.notifiers;

const channelPayload = z.object({ channel: z.enum(NotifierChannel) });

/** SMTP settings (`SMTPConfig`), stored encrypted. */
export const smtpConfigSchema = z.object({
  preset: z.enum(SMTPPreset),
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  auth: z.object({
    user: z.string().trim().min(1),
    /** Write-only. Empty or absent keeps the stored password for the same host, port and user. */
    pass: z.string().optional(),
  }),
  fromEmail: z.string().optional(),
  toEmail: z.string().optional(),
});

/** Only the email notifier has settings to configure. */
export const notifierInputSchema = z.object({
  channel: z.literal(NotifierChannel.EMAIL_SMTP),
  displayName: z.string(),
  enabled: z.boolean().optional(),
  config: smtpConfigSchema,
});

export type NotifierConfigureInput = z.input<typeof notifierInputSchema>;

export const notifiers = {
  list: { channel: C.list, request: z.void(), args: {} as [], response: {} as NotifierView[] },
  get: {
    channel: C.get,
    request: channelPayload,
    args: {} as [channel: NotifierChannel],
    response: {} as NotifierView | null,
  },
  configure: {
    channel: C.configure,
    request: notifierInputSchema,
    args: {} as [input: NotifierConfigureInput],
    response: {} as NotifierView,
  },
  enable: {
    channel: C.enable,
    request: channelPayload,
    args: {} as [channel: NotifierChannel],
    response: {} as boolean,
  },
  disable: {
    channel: C.disable,
    request: channelPayload,
    args: {} as [channel: NotifierChannel],
    response: {} as boolean,
  },
  test: {
    channel: C.test,
    request: channelPayload,
    args: {} as [channel: NotifierChannel],
    response: {} as TestConnectionResult,
  },
} satisfies Namespace;
