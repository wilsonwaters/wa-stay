/**
 * `providers`: the registered accommodation providers, their access gates, their experiments
 * and their notices. Gate changes arrive as `provider:access-status` events.
 */

import { z } from 'zod';
import {
  ExperimentIdSchema,
  ProviderIdSchema,
  type AccessStatus,
  type ProviderId,
  type ProviderManifest,
} from '../types/provider.types';
import { assertTypeEquals } from '../utils/type-equality';
import { CHANNELS } from './channels';
import type { Namespace } from './define';

const C = CHANNELS.providers;

/**
 * The `providers.accessStatus`, `providers.experiments`, `providers.notice` and
 * `providers.withdrawNotice` payload.
 */
export interface ProviderAccessStatusRequest {
  providerId: ProviderId;
}

/** The `providers.setExperiment` payload. */
export interface SetExperimentRequest {
  providerId: ProviderId;
  /** One of the provider's `manifest.experiments`. */
  experimentId: string;
  enabled: boolean;
}

/**
 * One of a provider's experiments (`manifest.experiments`) in this run. A change takes effect
 * when WA Stay restarts, so `enabled` and `active` differ until then.
 */
export interface ProviderExperimentState {
  id: string;
  /** The person's stored choice: on from the next start. */
  enabled: boolean;
  /** On in this run: the provider registered with it. */
  active: boolean;
  /** Stored on, but the provider could not register with it, so it runs without (see the logs). */
  failed?: boolean;
}

/** The `providers.acceptNotice` payload. */
export interface AcceptNoticeRequest {
  providerId: ProviderId;
  /** The notice's version the person read (`manifest.notice.version`). */
  version: number;
}

/**
 * Whether the person has accepted a provider's notice (`manifest.notice`), at its current
 * version. Until then WA Stay sends the provider nothing.
 */
export interface ProviderNoticeStatus {
  providerId: ProviderId;
  /** The provider declares a notice. */
  required: boolean;
  /** Accepted at the current version; always true when none is required. */
  accepted: boolean;
  /** The current notice's version, when there is one. */
  version?: number;
  /** When the person accepted it (ISO 8601), while accepted. */
  acceptedAt?: string;
}

const accessStatusRequest = z.object({ providerId: ProviderIdSchema });
assertTypeEquals<z.input<typeof accessStatusRequest>, ProviderAccessStatusRequest>(true);
assertTypeEquals<z.output<typeof accessStatusRequest>, ProviderAccessStatusRequest>(true);

const setExperimentRequest = z.object({
  providerId: ProviderIdSchema,
  experimentId: ExperimentIdSchema,
  enabled: z.boolean(),
});
assertTypeEquals<z.input<typeof setExperimentRequest>, SetExperimentRequest>(true);
assertTypeEquals<z.output<typeof setExperimentRequest>, SetExperimentRequest>(true);

const acceptNoticeRequest = z.object({
  providerId: ProviderIdSchema,
  version: z.number().int().min(1),
});
assertTypeEquals<z.input<typeof acceptNoticeRequest>, AcceptNoticeRequest>(true);
assertTypeEquals<z.output<typeof acceptNoticeRequest>, AcceptNoticeRequest>(true);

export const providers = {
  /** Every provider's manifest, sorted by name. */
  list: { channel: C.list, request: z.void(), args: {} as [], response: {} as ProviderManifest[] },
  /** The provider's queue state; `state: 'unsupported'` when it has no gate. */
  accessStatus: {
    channel: C.accessStatus,
    request: accessStatusRequest,
    args: {} as [providerId: ProviderId],
    response: {} as AccessStatus,
  },
  /** The provider's experiments, in its manifest's order: stored choice and this run's state. */
  experiments: {
    channel: C.experiments,
    request: accessStatusRequest,
    args: {} as [providerId: ProviderId],
    response: {} as ProviderExperimentState[],
  },
  /**
   * Stores whether an experiment is on, from the next start, and answers the experiments.
   * `NOT_FOUND` for one the provider does not declare; `ACCOUNT_BUSY` for turning off one that
   * turns on holds while a hold or snipe needs the provider.
   */
  setExperiment: {
    channel: C.setExperiment,
    request: setExperimentRequest,
    args: {} as [providerId: ProviderId, experimentId: string, enabled: boolean],
    response: {} as ProviderExperimentState[],
  },
  /** Whether the provider's notice is accepted (`required: false` when it has none). */
  notice: {
    channel: C.notice,
    request: accessStatusRequest,
    args: {} as [providerId: ProviderId],
    response: {} as ProviderNoticeStatus,
  },
  /**
   * Accepts the provider's notice at `version`, and answers its status. `NOT_FOUND` when the
   * provider has no notice; `VALIDATION` (on `version`) when the notice has changed since.
   */
  acceptNotice: {
    channel: C.acceptNotice,
    request: acceptNoticeRequest,
    args: {} as [providerId: ProviderId, version: number],
    response: {} as ProviderNoticeStatus,
  },
  /**
   * Withdraws the person's acceptance: WA Stay stops checking the provider at once (its
   * watches pause, its cached availability goes). Answers the status.
   */
  withdrawNotice: {
    channel: C.withdrawNotice,
    request: accessStatusRequest,
    args: {} as [providerId: ProviderId],
    response: {} as ProviderNoticeStatus,
  },
} satisfies Namespace;
