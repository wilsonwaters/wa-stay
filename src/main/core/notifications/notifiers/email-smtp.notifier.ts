/**
 * SMTP Email Notifier
 * Sends notifications via email using SMTP (Nodemailer).
 *
 * Emails carry the WA Stay brand: the sender name, the subject prefix, the wordmark (with the
 * icon as an inline image when it exists) and D1 palette colours (`@shared/constants/brand`).
 * Each email names the provider it is about, when there is one.
 */

import fs from 'fs';
import nodemailer, { Transporter } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { APP_NAME, BRAND_COLORS } from '@shared/constants';
import {
  NotifierChannel,
  NotificationMessage,
  NotificationDeliveryResult,
  TestConnectionResult,
  NotifierValidationResult,
  SMTPConfig,
  SMTP_PRESETS,
  SMTPPreset,
} from '@shared/types';
import { BaseNotifier } from './base.notifier';

/** The `cid:` of the inline icon beside the wordmark. */
const LOGO_CID = 'wa-stay-logo';

const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const DISPLAY_FONT = "Georgia, 'Times New Roman', serif";

export interface SmtpEmailNotifierOptions {
  /**
   * The short name (`manifest.shortName`) of a provider, or `undefined` when the registry
   * does not know it. Without it emails name no provider.
   */
  providerName?: (providerId: string) => string | undefined;
  /**
   * The small WA Stay icon PNG (`getEmailLogoPath`, 80 px for the 40 px slot), attached inline
   * and shown beside the wordmark if the file exists.
   */
  logoPath?: string;
}

/** What an email says, in both forms. */
interface EmailContent {
  subject: string;
  html: string;
  text: string;
  attachments: Mail.Attachment[];
}

export class SmtpEmailNotifier extends BaseNotifier {
  private transporter: Transporter<SMTPTransport.SentMessageInfo> | null = null;
  private readonly providerName: (providerId: string) => string | undefined;
  private readonly logoPath: string | undefined;

  constructor(options: SmtpEmailNotifierOptions = {}) {
    super(NotifierChannel.EMAIL_SMTP, 'Email (SMTP)');
    this.providerName = options.providerName ?? (() => undefined);
    this.logoPath = options.logoPath;
  }

  /**
   * Get SMTP configuration
   */
  private getSmtpConfig(): SMTPConfig | null {
    const config = this.config as unknown as SMTPConfig;
    if (!config || !config.host || !config.auth?.user || !config.auth?.pass) {
      return null;
    }
    return config;
  }

  /**
   * Create or get the nodemailer transporter
   */
  private getTransporter(): Transporter<SMTPTransport.SentMessageInfo> {
    const config = this.getSmtpConfig();
    if (!config) {
      throw new Error('SMTP not configured');
    }

    // Always create a fresh transporter to ensure we're using current config
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.auth.user,
        pass: config.auth.pass,
      },
      // Additional options for reliability
      connectionTimeout: 10000, // 10 seconds
      greetingTimeout: 10000,
      socketTimeout: 30000, // 30 seconds
    });

    return this.transporter;
  }

  /**
   * Configure the notifier
   */
  configure(config: Record<string, unknown>): void {
    super.configure(config);
    // Reset transporter when config changes
    this.transporter = null;
  }

  /**
   * Send a notification via email
   */
  async send(message: NotificationMessage): Promise<NotificationDeliveryResult> {
    const config = this.getSmtpConfig();
    if (!config) {
      return {
        success: false,
        error: 'SMTP not configured',
      };
    }

    try {
      const transporter = this.getTransporter();
      const senderEmail = config.fromEmail || config.auth.user;
      const toEmail = config.toEmail || senderEmail;

      const email = this.buildEmail(message);

      const info = await transporter.sendMail({
        from: this.from(senderEmail),
        to: toEmail,
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: email.attachments,
      });

      this.log('info', `Email sent successfully to ${toEmail}`, {
        messageId: info.messageId,
      });

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error: any) {
      this.log('error', 'Failed to send email', error);
      return {
        success: false,
        error: error.message || 'Failed to send email',
      };
    }
  }

  /**
   * Test the SMTP connection
   */
  async testConnection(): Promise<TestConnectionResult> {
    const config = this.getSmtpConfig();
    if (!config) {
      return {
        success: false,
        message: 'SMTP not configured',
        error: 'Please configure SMTP settings first',
      };
    }

    try {
      const transporter = this.getTransporter();

      // Verify connection
      await transporter.verify();

      // Send a test email
      const senderEmail = config.fromEmail || config.auth.user;
      const toEmail = config.toEmail || senderEmail;
      const email = this.buildEmail({
        title: 'Test email',
        message: `This is a test email from ${APP_NAME}. If you received it, your email notifications are set up correctly.`,
      });
      const info = await transporter.sendMail({
        from: this.from(senderEmail),
        to: toEmail,
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: email.attachments,
      });

      this.log('info', 'Test email sent successfully', { messageId: info.messageId });

      return {
        success: true,
        message: `Test email sent successfully to ${toEmail}`,
      };
    } catch (error: any) {
      this.log('error', 'SMTP connection test failed', error);

      // Provide helpful error messages
      let errorMessage = error.message || 'Connection test failed';

      if (error.code === 'EAUTH') {
        errorMessage = 'Authentication failed. Please check your email and app password.';
      } else if (error.code === 'ECONNREFUSED') {
        errorMessage = 'Connection refused. Please check the SMTP host and port.';
      } else if (error.code === 'ETIMEDOUT') {
        errorMessage = 'Connection timed out. Please check your network and SMTP settings.';
      }

      return {
        success: false,
        message: 'Connection test failed',
        error: errorMessage,
      };
    }
  }

  /**
   * Validate the SMTP configuration
   */
  validate(): NotifierValidationResult {
    const errors: string[] = [];
    const config = this.config as Partial<SMTPConfig>;

    if (!config) {
      return { valid: false, errors: ['No configuration provided'] };
    }

    if (!config.host) {
      errors.push('SMTP host is required');
    }

    if (!config.port || config.port < 1 || config.port > 65535) {
      errors.push('Valid SMTP port is required (1-65535)');
    }

    if (!config.auth?.user) {
      errors.push('Username is required');
    }

    // For Gmail/Outlook presets, username must be an email
    // For custom SMTP (or if preset is not set), username can be anything
    const isPresetProvider =
      config.preset === SMTPPreset.GMAIL || config.preset === SMTPPreset.OUTLOOK;

    if (isPresetProvider) {
      if (config.auth?.user && !this.isValidEmail(config.auth.user)) {
        errors.push('Invalid email address format');
      }
    } else {
      // Custom SMTP: validate fromEmail if provided
      if (config.fromEmail && !this.isValidEmail(config.fromEmail)) {
        errors.push('Invalid sender email address format');
      }
    }

    if (!config.auth?.pass) {
      errors.push('App password is required');
    }

    if (config.toEmail && !this.isValidEmail(config.toEmail)) {
      errors.push('Invalid recipient email address format');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /** The From header: the WA Stay name with the sending address. */
  private from(senderEmail: string): string {
    return `"${APP_NAME}" <${senderEmail}>`;
  }

  /** Subject, HTML and text of one email, plus the inline icon when there is one. */
  private buildEmail(message: NotificationMessage): EmailContent {
    const provider = message.providerId ? this.providerName(message.providerId) : undefined;
    const link = httpLink(message.actionUrl);
    const logo = this.logoPath && fs.existsSync(this.logoPath) ? this.logoPath : undefined;

    return {
      subject: this.buildSubject(message, provider),
      html: this.buildHtmlEmail(message, provider, link, logo !== undefined),
      text: this.buildTextEmail(message, provider, link),
      attachments: logo ? [{ filename: 'wa-stay.png', path: logo, cid: LOGO_CID }] : [],
    };
  }

  /**
   * `WA Stay: <title> · <provider> · <location>`, leaving out the parts the message lacks, and
   * the location when the title already names it ("Sites available at Dales").
   */
  private buildSubject(message: NotificationMessage, provider: string | undefined): string {
    const location = message.locationName;
    const named = location && message.title.toLowerCase().includes(location.toLowerCase());
    const parts = [message.title, provider, named ? undefined : location].filter(
      (part): part is string => Boolean(part)
    );
    return `${APP_NAME}: ${parts.join(' · ')}`;
  }

  /**
   * Build HTML email content
   */
  private buildHtmlEmail(
    message: NotificationMessage,
    provider: string | undefined,
    link: string | undefined,
    hasLogo: boolean
  ): string {
    const c = BRAND_COLORS;
    const esc = (text: string) => this.escapeHtml(text);

    const logo = hasLogo
      ? `<td style="padding-right: 12px; vertical-align: middle;">
                      <img src="cid:${LOGO_CID}" width="40" height="40" alt="" style="display: block; border: 0;">
                    </td>`
      : '';

    const details = [
      message.locationName ? ['Location', message.locationName] : null,
      provider ? ['Provider', provider] : null,
    ]
      .filter((row): row is string[] => row !== null)
      .map(
        ([label, value]) =>
          `<p style="margin: 0 0 4px 0; color: ${c.link}; font-size: 14px; font-weight: bold;">
                ${label}: ${esc(value)}
              </p>`
      )
      .join('\n              ');

    const actionButton = link
      ? `<a href="${esc(link)}"
                 style="display: inline-block;
                        background-color: ${c.accent};
                        color: ${c.accentText};
                        font-weight: bold;
                        padding: 12px 24px;
                        text-decoration: none;
                        border-radius: 8px;
                        margin-top: 8px;">
                View details
              </a>`
      : '';

    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${esc(message.title)}</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: ${FONT}; background-color: ${c.canvas};">
          <div style="max-width: 600px; margin: 0 auto; padding: 24px 16px;">
            <div style="background-color: ${c.surface}; border: 1px solid ${c.border}; border-radius: 12px; padding: 24px;">
              <div style="border-bottom: 3px solid ${c.ocean}; padding-bottom: 16px; margin-bottom: 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    ${logo}
                    <td style="vertical-align: middle; font-family: ${DISPLAY_FONT}; font-size: 26px; font-weight: bold; color: ${c.text};">
                      ${APP_NAME}
                    </td>
                  </tr>
                </table>
              </div>

              <h2 style="margin: 0 0 12px 0; color: ${c.text}; font-size: 20px;">
                ${esc(message.title)}
              </h2>

              ${details}

              <p style="margin: 12px 0 16px 0; color: ${c.textSecondary}; font-size: 16px; line-height: 1.5;">
                ${esc(message.message)}
              </p>

              ${actionButton}

              <hr style="border: none; border-top: 1px solid ${c.border}; margin: 24px 0;">

              <p style="margin: 0; color: ${c.textMuted}; font-size: 12px;">
                Sent by ${APP_NAME}. You can turn these emails off in the app's settings.
              </p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Build plain text email content
   */
  private buildTextEmail(
    message: NotificationMessage,
    provider: string | undefined,
    link: string | undefined
  ): string {
    let text = `${APP_NAME}\n\n`;
    text += `${message.title}\n\n`;

    if (message.locationName) text += `Location: ${message.locationName}\n`;
    if (provider) text += `Provider: ${provider}\n`;
    if (message.locationName || provider) text += '\n';

    text += `${message.message}\n`;

    if (link) {
      text += `\nView details: ${link}\n`;
    }

    text += `\n---\nSent by ${APP_NAME}.`;

    return text;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (char) => map[char]);
  }

  /**
   * Apply SMTP preset configuration
   */
  static applyPreset(
    preset: SMTPPreset,
    email: string,
    password: string,
    toEmail?: string
  ): SMTPConfig {
    const presetConfig = SMTP_PRESETS[preset];
    return {
      preset,
      host: presetConfig.host,
      port: presetConfig.port,
      secure: presetConfig.secure,
      auth: {
        user: email,
        pass: password,
      },
      toEmail: toEmail || email,
    };
  }
}

/** The URL when it is an absolute http(s) URL; anything else (`javascript:`, a route) is dropped. */
function httpLink(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
