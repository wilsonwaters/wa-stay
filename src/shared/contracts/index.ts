/**
 * The IPC contract: the single source of truth for what the renderer can call.
 *
 * `contract` maps each namespace to its methods. Each method declares its channel
 * (`<namespace>:<kebab-method>`, from the zod-free `channels.ts`), a zod request schema and a
 * response type. Main registers one handler per method through `ipc/handle.ts`; the preload
 * implements `WindowApi` from the same definitions. V1 adds its namespaces here: there is no
 * second registry.
 */

import { accounts } from './accounts';
import { app } from './app';
import { bookings } from './bookings';
import { catalog } from './catalog';
import type { Channels } from './channels';
import type { MethodDef, NamespaceApi } from './define';
import type { EventsApi } from './events';
import { notifications } from './notifications';
import { notifiers } from './notifiers';
import { providers } from './providers';
import { settings } from './settings';
import { snipes } from './snipes';
import { updater } from './updater';
import { watches } from './watches';

export const contract = {
  bookings,
  watches,
  snipes,
  notifications,
  notifiers,
  settings,
  app,
  updater,
  providers,
  catalog,
  accounts,
} as const;

export type Contract = typeof contract;
export type ContractNamespace = keyof Contract;

// Compile-time parity with `channels.ts`: every channel has a method definition carrying
// exactly that channel name. (The parity test also checks the other direction at runtime.)
type ChannelParity = {
  [N in keyof Channels]: { [M in keyof Channels[N]]: MethodDef & { channel: Channels[N][M] } };
};
const contractMatchesChannels: ChannelParity = contract;
void contractMatchesChannels;

/** `window.api`, as the preload exposes it. */
export type WindowApi = { [N in ContractNamespace]: NamespaceApi<Contract[N]> } & {
  events: EventsApi;
};

export { CHANNELS, EVENT_NAMES, isEventName } from './channels';
export type { EventName, NamespaceName } from './channels';
export type {
  ApiMethod,
  MethodDef,
  Namespace,
  NamespaceApi,
  RequestInput,
  RequestOutput,
  ResponseOf,
} from './define';
export type { EventPayload, EventPayloads, EventsApi, EventSink, UpdateProgress } from './events';
export type { AppInfo, LaunchAtLogin } from './app';
export type { UpdateStatus } from './updater';
export type { CatalogAvailabilityOptions } from './catalog';
export { SETTING_KEYS, WRITABLE_SETTING_KEYS, settingDefault } from './settings';
export type { SettingDefinition, SettingKey, SettingValue, WritableSettingKey } from './settings';
