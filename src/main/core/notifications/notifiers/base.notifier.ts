/**
 * Base Notifier
 * Abstract base class for all notifiers
 */

import {
  NotifierChannel,
  NotificationMessage,
  NotificationDeliveryResult,
  TestConnectionResult,
  NotifierValidationResult,
} from '@shared/types';
import { logger } from '../../../utils/logger';

export abstract class BaseNotifier {
  protected channel: NotifierChannel;
  protected displayName: string;
  protected enabled: boolean = false;
  protected config: Record<string, unknown> = {};

  constructor(channel: NotifierChannel, displayName: string) {
    this.channel = channel;
    this.displayName = displayName;
  }

  /**
   * Get the channel identifier
   */
  getChannel(): NotifierChannel {
    return this.channel;
  }

  /**
   * Get the display name
   */
  getDisplayName(): string {
    return this.displayName;
  }

  /**
   * Check if the notifier is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Set enabled status
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Configure the notifier with settings
   */
  configure(config: Record<string, unknown>): void {
    this.config = config;
  }

  /**
   * Get current configuration
   */
  getConfig(): Record<string, unknown> {
    return this.config;
  }

  /**
   * Send a notification
   * Must be implemented by each notifier
   */
  abstract send(message: NotificationMessage): Promise<NotificationDeliveryResult>;

  /**
   * Test the connection/configuration
   * Must be implemented by each notifier
   */
  abstract testConnection(): Promise<TestConnectionResult>;

  /**
   * Validate the configuration
   * Must be implemented by each notifier
   */
  abstract validate(): NotifierValidationResult;

  /**
   * Log a message with notifier context
   */
  protected log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: unknown): void {
    const prefix = `[${this.displayName}]`;
    switch (level) {
      case 'info':
        logger.info(`${prefix} ${message}`, data);
        break;
      case 'warn':
        logger.warn(`${prefix} ${message}`, data);
        break;
      case 'error':
        logger.error(`${prefix} ${message}`, data);
        break;
      case 'debug':
        logger.debug(`${prefix} ${message}`, data);
        break;
    }
  }
}
