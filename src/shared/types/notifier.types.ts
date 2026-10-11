/**
 * Notifier Types
 * Types for the pluggable notifier system: outbound notification channels such as email
 * (SMTP). In WA Stay a "provider" is an accommodation source, never a notifier.
 */

import type { SecretState } from './secret.types';

/**
 * Supported notification channels
 */
export enum NotifierChannel {
  EMAIL_SMTP = 'email_smtp',
  // Future channels
  // TELEGRAM = 'telegram',
  // DISCORD = 'discord',
}

/**
 * Notifier status
 */
export enum NotifierStatus {
  NOT_CONFIGURED = 'not_configured',
  CONFIGURED = 'configured',
  ERROR = 'error',
}

/**
 * SMTP notifier preset types
 */
export enum SMTPPreset {
  GMAIL = 'gmail',
  OUTLOOK = 'outlook',
  CUSTOM = 'custom',
}

/**
 * SMTP configuration
 */
export interface SMTPConfig {
  preset: SMTPPreset;
  host: string;
  port: number;
  secure: boolean; // true for SSL/TLS on port 465, false for STARTTLS on 587
  auth: {
    user: string; // Username for SMTP auth (email address for Gmail/Outlook, can be different for custom)
    pass: string; // App password (will be encrypted)
  };
  fromEmail?: string; // Sender email address (for custom SMTP where username != email, defaults to auth.user)
  toEmail?: string; // Recipient email (defaults to fromEmail or auth.user if not set)
}

/** `lastError` of a notifier whose stored settings cannot be decrypted. */
export const NOTIFIER_SECRET_UNREADABLE = 'Saved password could not be decrypted; re-enter it';

/**
 * Notifier configuration stored in the `notifiers` table
 */
export interface Notifier {
  id: number;
  channel: NotifierChannel;
  displayName: string;
  enabled: boolean;
  config: SMTPConfig | Record<string, unknown>; // Notifier-specific config
  /**
   * The stored (encrypted) config: `unreadable` means it could not be decrypted, so `config`
   * is empty, `status` is `error` and `lastError` is `NOTIFIER_SECRET_UNREADABLE`.
   */
  secretState: SecretState;
  status: NotifierStatus;
  lastTestedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating/updating a notifier
 */
export interface NotifierInput {
  channel: NotifierChannel;
  displayName: string;
  enabled?: boolean;
  config: SMTPConfig | Record<string, unknown>;
}

/** SMTP settings as the renderer sees them: the password is write-only and never returned. */
export type SMTPConfigView = Omit<SMTPConfig, 'auth'> & { auth: { user: string } };

/** What a stored SMTP password belongs to: the server (host and port) and the account. */
export type SMTPAccount = Pick<SMTPConfig, 'host' | 'port'> & { auth: { user: string } };

/**
 * Saving SMTP settings without a password keeps the stored one only for the same server
 * and account, so the stored password is never sent to a server it was not saved for.
 */
export function isSameSmtpAccount(a: SMTPAccount, b: SMTPAccount): boolean {
  return (
    a.host.trim().toLowerCase() === b.host.trim().toLowerCase() &&
    a.port === b.port &&
    a.auth.user.trim() === b.auth.user.trim()
  );
}

/** The error for a server or account change saved without a new password. */
export const SMTP_NEW_ACCOUNT_PASSWORD = 'Enter the password for the new server/account';

/**
 * A notifier as IPC returns it: secrets removed from `config`, and `hasPassword` saying
 * whether one is stored.
 */
export interface NotifierView extends Omit<Notifier, 'config'> {
  config: SMTPConfigView | Record<string, unknown>;
  hasPassword: boolean;
}

/**
 * Notifier configuration for SMTP Email
 */
export interface SmtpNotifierConfig {
  channel: NotifierChannel.EMAIL_SMTP;
  config: SMTPConfig;
}

/**
 * Notification message to be dispatched
 */
export interface NotificationMessage {
  title: string;
  message: string;
  /** Linked from the message only when it is an http(s) URL. */
  actionUrl?: string;
  type?: string;
  /** The provider (`ProviderId`) the notification is about; absent for app-wide ones. */
  providerId?: string;
  /** The location it is about, e.g. a campground's name. */
  locationName?: string;
}

/**
 * Result of sending a notification through a notifier
 */
export interface NotificationDeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Delivery log entry
 */
export interface NotificationDeliveryLog {
  id: number;
  notificationId?: number;
  notifierChannel: NotifierChannel;
  status: 'sent' | 'failed' | 'pending';
  messageId?: string;
  errorMessage?: string;
  sentAt?: Date;
  createdAt: Date;
}

/**
 * Input for creating a delivery log entry
 */
export interface NotificationDeliveryLogInput {
  notificationId?: number;
  notifierChannel: NotifierChannel;
  status: 'sent' | 'failed' | 'pending';
  messageId?: string;
  errorMessage?: string;
  sentAt?: Date;
}

/**
 * Test connection result
 */
export interface TestConnectionResult {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Notifier validation result
 */
export interface NotifierValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * SMTP preset configurations
 */
export const SMTP_PRESETS: Record<SMTPPreset, Omit<SMTPConfig, 'auth' | 'toEmail' | 'preset'>> = {
  [SMTPPreset.GMAIL]: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // Uses STARTTLS
  },
  [SMTPPreset.OUTLOOK]: {
    host: 'smtp.office365.com',
    port: 587,
    secure: false, // Uses STARTTLS
  },
  [SMTPPreset.CUSTOM]: {
    host: '',
    port: 587,
    secure: false,
  },
};
