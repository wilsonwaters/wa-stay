/**
 * The email notifier's errors in plain words. Main keeps the raw error (nodemailer's code and
 * the server's reply) in the logs ("SMTP connection test failed"); the screen says what went
 * wrong and what to check.
 */
import { NOTIFIER_SECRET_UNREADABLE } from '../../../../../shared/types/notifier.types';

export interface SmtpServer {
  host?: string;
  port?: number;
}

const RULES: Array<[RegExp, (server: string, host: string) => string]> = [
  [
    /EAUTH|\b53[45]\b|invalid login|not accepted|authentication (failed|unsuccessful)/i,
    () => "The mail server didn't accept the account or password.",
  ],
  [
    /ENOTFOUND|EAI_AGAIN|getaddrinfo/i,
    (_server, host) => `Couldn't find the mail server ${host}. Check its name.`,
  ],
  [
    /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|socket hang up/i,
    (server) => `Couldn't reach the mail server at ${server}.`,
  ],
  [
    /ETIMEDOUT|timed? ?out|greeting never received/i,
    (server) => `The mail server at ${server} didn't answer in time.`,
  ],
  [
    /certificate|self[- ]signed|wrong version number|\bSSL\b|\bTLS\b/i,
    (server) => `Couldn't make a secure connection to ${server}. Check the security setting.`,
  ],
];

/** A raw error from the notifier as a sentence for the screen. */
export function friendlySmtpError(raw: string | undefined, { host, port }: SmtpServer): string {
  if (raw === NOTIFIER_SECRET_UNREADABLE) {
    return "The saved password couldn't be read on this computer. Enter it again.";
  }
  const name = host?.trim() || 'the mail server';
  const server = host?.trim() && port ? `${host.trim()}:${port}` : name;
  const rule = RULES.find(([pattern]) => pattern.test(raw ?? ''));
  return rule ? rule[1](server, name) : "The test email couldn't be sent.";
}

/** Where the full error is, for a failed test. */
export const SMTP_ERROR_DETAIL = 'The full error is in the log files (About, Open logs folder).';
