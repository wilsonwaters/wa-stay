/**
 * Events main sends to the renderer, and their payloads.
 *
 * The renderer subscribes with `window.api.events.on(name, cb)`, which returns an
 * unsubscribe function. Main emits through `RendererEvents` (`src/main/ipc/events.ts`), which
 * delivers only to trusted webContents.
 */

import type { Booking } from '../types/booking.types';
import type { CatalogUpdatedEvent } from '../types/catalog.types';
import type { AccessStatus, ProviderAccount } from '../types/provider.types';
import type { Notification } from '../types/notification.types';
import type { SiteSnipe } from '../types/site-sniper.types';
import type { Watch } from '../types/watch.types';
import type { EventName } from './channels';

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface EventPayloads {
  'notification:created': Notification;
  /** After every change to a watch (a deleted watch is sent once more, in its last state). */
  'watch:updated': Watch;
  /** After every change to a snipe (a deleted snipe is sent once more, in its last state). */
  'snipe:updated': SiteSnipe;
  /** After every change to a booking (a deleted booking is sent once more, in its last state). */
  'booking:updated': Booking;
  'updater:available': { version: string; releaseNotes?: string };
  'updater:not-available': null;
  'updater:downloaded': { version: string };
  'updater:progress': UpdateProgress;
  'updater:error': { error: string };
  /** An internal route such as `/watches/3`. Emitted by U5. */
  'app:navigate': { path: string };
  /** A provider's access gate (queue) changed state. */
  'provider:access-status': AccessStatus;
  /** A provider's catalogue was synced. Emitted by V5. */
  'catalog:updated': CatalogUpdatedEvent;
  /** A provider account's sign-in state changed. Emitted by V6. */
  'account:updated': ProviderAccount;
}

// Every event name has exactly one payload type.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const eventPayloadsCoverEveryEvent: Exact<keyof EventPayloads, EventName> = true;
void eventPayloadsCoverEveryEvent;

export type EventPayload<E extends EventName> = EventPayloads[E];

/** `window.api.events`. */
export interface EventsApi {
  /** Subscribes `callback` to `name`. The returned function removes this subscription only. */
  on<E extends EventName>(name: E, callback: (payload: EventPayloads[E]) => void): () => void;
}

/** What main-process services emit through. Implemented by `RendererEvents`. */
export interface EventSink {
  emit<E extends EventName>(name: E, payload: EventPayloads[E]): void;
}
