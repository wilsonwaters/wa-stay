/**
 * Main → renderer events. `emit` sends only to trusted webContents (`TrustedWebContents`),
 * never to every window. With no live window, an event is dropped without error.
 */

import type { EventName } from '@shared/contracts/channels';
import type { EventPayloads, EventSink } from '@shared/contracts/events';
import { logger } from '../utils/logger';
import type { TrustedWebContents } from './trusted-web-contents';

export class RendererEvents implements EventSink {
  constructor(private readonly targets: TrustedWebContents) {}

  emit<E extends EventName>(name: E, payload: EventPayloads[E]): void {
    for (const webContents of this.targets.list()) {
      if (webContents.isDestroyed()) continue;
      try {
        webContents.send(name, payload);
      } catch (error) {
        // A window that is closing can refuse the message; the event is dropped for it.
        logger.warn(`Event ${name} not delivered to webContents ${webContents.id}:`, error);
      }
    }
  }
}
