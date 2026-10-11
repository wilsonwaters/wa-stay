/**
 * `settings`: typed application settings (architecture-notes §12.7).
 *
 * `SETTING_KEYS` is the registry: every key the renderer may read, with its value schema, the
 * `valueType`/`category` main stores it under and the value `settings.get` answers while
 * nothing is stored. The renderer sends only `(key, value)`; an unknown key, a main-only key
 * (`rendererWritable: false`, written by another method such as `app.setAutoLaunch`) or a value
 * that fails the key's schema is rejected with `VALIDATION`. Streams that add settings add
 * their keys here.
 */

import { z } from 'zod';
import { NOTIFICATION_RETENTION_DAYS } from '../constants/app-constants';
import { SettingCategory, SettingValueType } from '../types/common.types';
import { CHANNELS } from './channels';
import type { Namespace } from './define';

export interface SettingDefinition {
  readonly schema: z.ZodType;
  readonly valueType: SettingValueType;
  readonly category: SettingCategory;
  /** What `settings.get` answers while nothing is stored. */
  readonly default: unknown;
  /**
   * `false`: only main writes it, through the method that also changes what it describes
   * (launch at login is an OS entry). `settings.set` refuses it.
   */
  readonly rendererWritable?: false;
}

/** A retention period: whole days, at least one, at most ten years. */
const RETENTION_DAYS = z.number().int().min(1).max(3650);

export const SETTING_KEYS = {
  /** Launch at login, written by `app.setAutoLaunch` (the name v1.x stored it under). */
  launchOnStartup: {
    schema: z.boolean(),
    valueType: SettingValueType.BOOLEAN,
    category: SettingCategory.GENERAL,
    default: false,
    rendererWritable: false,
  },
  /** A login launch opens minimised (`--hidden`), written by `app.setAutoLaunch`. */
  'app.startMinimised': {
    schema: z.boolean(),
    valueType: SettingValueType.BOOLEAN,
    category: SettingCategory.GENERAL,
    default: false,
    rendererWritable: false,
  },
  /** OS (desktop) notifications. The in-app list and email are not affected. */
  'notifications.desktop': {
    schema: z.boolean(),
    valueType: SettingValueType.BOOLEAN,
    category: SettingCategory.NOTIFICATIONS,
    default: true,
  },
  /** The OS notification's sound (its `silent` flag). Applies only with desktop notifications. */
  'notifications.sound': {
    schema: z.boolean(),
    valueType: SettingValueType.BOOLEAN,
    category: SettingCategory.NOTIFICATIONS,
    default: true,
  },
  /**
   * Days a notification is kept, read or not (the scheduler's retention job). Main-only: no
   * screen sets it.
   */
  'retention.notificationDays': {
    schema: RETENTION_DAYS,
    valueType: SettingValueType.NUMBER,
    category: SettingCategory.NOTIFICATIONS,
    default: NOTIFICATION_RETENTION_DAYS,
    rendererWritable: false,
  },
  /** Days a notifier delivery log (an email sent or failed) is kept. Main-only. */
  'retention.deliveryLogDays': {
    schema: RETENTION_DAYS,
    valueType: SettingValueType.NUMBER,
    category: SettingCategory.NOTIFICATIONS,
    default: NOTIFICATION_RETENTION_DAYS,
    rendererWritable: false,
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTING_KEYS;
export type SettingValue<K extends SettingKey = SettingKey> = z.infer<
  (typeof SETTING_KEYS)[K]['schema']
>;

/** The keys `settings.set` accepts from the renderer. */
export type WritableSettingKey = {
  [K in SettingKey]: (typeof SETTING_KEYS)[K] extends { rendererWritable: false } ? never : K;
}[SettingKey];

const ALL_KEYS = Object.keys(SETTING_KEYS) as SettingKey[];

export const WRITABLE_SETTING_KEYS = ALL_KEYS.filter(
  (key) => (SETTING_KEYS[key] as SettingDefinition).rendererWritable !== false
) as WritableSettingKey[];

/** The value a key has while nothing is stored. */
export function settingDefault<K extends SettingKey>(key: K): SettingValue<K> {
  return SETTING_KEYS[key].default as SettingValue<K>;
}

const settingKey = z.enum(ALL_KEYS as [SettingKey, ...SettingKey[]]);
const writableSettingKey = z.enum(
  WRITABLE_SETTING_KEYS as [WritableSettingKey, ...WritableSettingKey[]]
);

const setRequest = z
  .object({ key: writableSettingKey, value: z.unknown() })
  .superRefine(({ key, value }, ctx) => {
    const result = SETTING_KEYS[key].schema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: 'custom',
          message: issue.message,
          path: ['value', ...issue.path],
        });
      }
    }
  });

const C = CHANNELS.settings;

export const settings = {
  /** The stored value, or the key's default. */
  get: {
    channel: C.get,
    request: z.object({ key: settingKey }),
    args: {} as [key: SettingKey],
    response: {} as SettingValue,
  },
  set: {
    channel: C.set,
    request: setRequest,
    args: {} as [key: WritableSettingKey, value: SettingValue],
    response: {} as boolean,
  },
  getAll: {
    channel: C.getAll,
    request: z.void(),
    args: {} as [],
    response: {} as Record<string, unknown>,
  },
} satisfies Namespace;
