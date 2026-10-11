/**
 * Notification Dispatcher
 * Orchestrates sending notifications through all enabled notifiers
 */

import {
  NOTIFIER_SECRET_UNREADABLE,
  NotifierChannel,
  NotificationMessage,
  NotificationDeliveryResult,
  NotificationDeliveryLogInput,
  TestConnectionResult,
  NotifierValidationResult,
} from '@shared/types';
import { BaseNotifier } from './notifiers/base.notifier';
import { NotifierRepository } from '../../database/repositories/notifier.repository';
import { logger } from '../../utils/logger';

export interface DispatchResult {
  channel: NotifierChannel;
  result: NotificationDeliveryResult;
}

export class NotificationDispatcher {
  private notifiers: Map<NotifierChannel, BaseNotifier> = new Map();
  private notifierRepository: NotifierRepository;
  /** Notifiers whose stored settings cannot be decrypted: never sent to, until saved again. */
  private unreadable = new Set<NotifierChannel>();
  /** Unreadable notifiers already logged by `dispatch` (it logs each one once). */
  private unreadableLogged = new Set<NotifierChannel>();

  /** The notifiers are built by the composition root (`app/container.ts`) and passed in. */
  constructor(notifierRepository: NotifierRepository, notifiers: BaseNotifier[]) {
    this.notifierRepository = notifierRepository;
    this.registerNotifiers(notifiers);
  }

  /**
   * Register the given notifiers, one per channel
   */
  private registerNotifiers(notifiers: BaseNotifier[]): void {
    for (const notifier of notifiers) {
      this.notifiers.set(notifier.getChannel(), notifier);
    }

    // Load configurations from database
    this.loadNotifierConfigurations();

    logger.info(
      'Notification dispatcher initialized with notifiers:',
      Array.from(this.notifiers.keys())
    );
  }

  /**
   * Load notifier configurations from database. A notifier whose stored settings cannot be
   * decrypted is not configured: `dispatch` skips it instead of sending with an empty config.
   */
  loadNotifierConfigurations(): void {
    try {
      const storedNotifiers = this.notifierRepository.findAll();

      for (const stored of storedNotifiers) {
        const notifier = this.notifiers.get(stored.channel);
        if (stored.secretState === 'unreadable') {
          this.unreadable.add(stored.channel);
          notifier?.setEnabled(stored.enabled);
          continue;
        }
        this.unreadable.delete(stored.channel);
        if (notifier) {
          notifier.configure(stored.config as Record<string, unknown>);
          notifier.setEnabled(stored.enabled);
          logger.debug(`Loaded configuration for ${stored.channel}`, {
            enabled: stored.enabled,
          });
        }
      }
    } catch (error) {
      logger.error('Error loading notifier configurations:', error);
    }
  }

  /**
   * Dispatch a notification to all enabled notifiers
   */
  async dispatch(message: NotificationMessage): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];

    for (const [channel, notifier] of this.notifiers) {
      if (!notifier.isEnabled()) {
        logger.debug(`Skipping disabled notifier: ${channel}`);
        continue;
      }

      if (this.unreadable.has(channel)) {
        if (!this.unreadableLogged.has(channel)) {
          this.unreadableLogged.add(channel);
          logger.warn(
            `Skipping notifier ${channel}: its saved settings could not be decrypted; re-enter them in Settings`
          );
        }
        results.push({ channel, result: { success: false, error: NOTIFIER_SECRET_UNREADABLE } });
        continue;
      }

      // Validate configuration before sending
      const validation = notifier.validate();
      if (!validation.valid) {
        logger.warn(`Notifier ${channel} validation failed:`, validation.errors);
        results.push({
          channel,
          result: {
            success: false,
            error: `Configuration invalid: ${validation.errors.join(', ')}`,
          },
        });
        continue;
      }

      try {
        logger.info(`Dispatching notification via ${channel}:`, { title: message.title });
        const result = await notifier.send(message);
        results.push({ channel, result });

        // Log the delivery to database
        this.recordDelivery({
          notifierChannel: channel,
          status: result.success ? 'sent' : 'failed',
          messageId: result.messageId,
          errorMessage: result.error,
          sentAt: result.success ? new Date() : undefined,
        });

        if (result.success) {
          logger.info(`Notification sent successfully via ${channel}`, {
            messageId: result.messageId,
          });
        } else {
          logger.error(`Failed to send notification via ${channel}:`, result.error);
        }
      } catch (error: any) {
        logger.error(`Error dispatching notification via ${channel}:`, error);
        results.push({
          channel,
          result: {
            success: false,
            error: error.message || 'Unknown error',
          },
        });

        // Log the failed delivery
        this.recordDelivery({
          notifierChannel: channel,
          status: 'failed',
          errorMessage: error.message || 'Unknown error',
        });
      }
    }

    return results;
  }

  /**
   * Writes a delivery-log row. A logging failure is logged and swallowed: it must not turn a
   * send into a failure, nor stop dispatch to the remaining notifiers.
   */
  private recordDelivery(entry: NotificationDeliveryLogInput): void {
    try {
      this.notifierRepository.logDelivery(entry);
    } catch (error) {
      logger.error(`Failed to write delivery log for ${entry.notifierChannel}:`, error);
    }
  }

  /**
   * Get a specific notifier
   */
  getNotifier(channel: NotifierChannel): BaseNotifier | undefined {
    return this.notifiers.get(channel);
  }

  /**
   * Get all registered notifiers
   */
  getAllNotifiers(): Map<NotifierChannel, BaseNotifier> {
    return this.notifiers;
  }

  /**
   * Configure a specific notifier
   */
  configureNotifier(
    channel: NotifierChannel,
    config: Record<string, unknown>,
    enabled: boolean
  ): void {
    const notifier = this.notifiers.get(channel);
    // Saved again by the user: readable from now on
    this.unreadable.delete(channel);
    this.unreadableLogged.delete(channel);
    if (notifier) {
      notifier.configure(config);
      notifier.setEnabled(enabled);
      logger.info(`Notifier ${channel} configured`, { enabled });
    } else {
      logger.warn(`Notifier not found: ${channel}`);
    }
  }

  /** Whether the notifier's stored settings could not be decrypted (it is never sent to). */
  isUnreadable(channel: NotifierChannel): boolean {
    return this.unreadable.has(channel);
  }

  /**
   * Test a notifier's connection
   */
  async testNotifier(channel: NotifierChannel): Promise<TestConnectionResult> {
    const notifier = this.notifiers.get(channel);
    if (!notifier) {
      return {
        success: false,
        message: 'Notifier not found',
        error: `Unknown channel: ${channel}`,
      };
    }

    if (this.unreadable.has(channel)) {
      return {
        success: false,
        message: 'Configuration unreadable',
        error: NOTIFIER_SECRET_UNREADABLE,
      };
    }

    // Validate configuration first
    const validation = notifier.validate();
    if (!validation.valid) {
      return {
        success: false,
        message: 'Configuration invalid',
        error: validation.errors.join(', '),
      };
    }

    try {
      return await notifier.testConnection();
    } catch (error: any) {
      return {
        success: false,
        message: 'Test failed',
        error: error.message || 'Unknown error',
      };
    }
  }

  /**
   * Validate a notifier's configuration
   */
  validateNotifier(channel: NotifierChannel): NotifierValidationResult {
    const notifier = this.notifiers.get(channel);
    if (!notifier) {
      return {
        valid: false,
        errors: [`Unknown channel: ${channel}`],
      };
    }

    return notifier.validate();
  }

  /**
   * Get notifier status information
   */
  getNotifierStatus(channel: NotifierChannel): {
    exists: boolean;
    enabled: boolean;
    valid: boolean;
    errors: string[];
  } {
    const notifier = this.notifiers.get(channel);
    if (!notifier) {
      return {
        exists: false,
        enabled: false,
        valid: false,
        errors: ['Notifier not found'],
      };
    }

    const validation = notifier.validate();
    return {
      exists: true,
      enabled: notifier.isEnabled(),
      valid: validation.valid,
      errors: validation.errors,
    };
  }
}
