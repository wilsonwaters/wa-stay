/**
 * `providers`: the registered accommodation providers and their access gates.
 * Gate changes arrive as `provider:access-status` events.
 */

import { z } from 'zod';
import {
  ProviderIdSchema,
  type AccessStatus,
  type ProviderId,
  type ProviderManifest,
} from '../types/provider.types';
import { assertTypeEquals } from '../utils/type-equality';
import { CHANNELS } from './channels';
import type { Namespace } from './define';

const C = CHANNELS.providers;

/** The `providers.accessStatus` payload. */
export interface ProviderAccessStatusRequest {
  providerId: ProviderId;
}

const accessStatusRequest = z.object({ providerId: ProviderIdSchema });
assertTypeEquals<z.input<typeof accessStatusRequest>, ProviderAccessStatusRequest>(true);
assertTypeEquals<z.output<typeof accessStatusRequest>, ProviderAccessStatusRequest>(true);

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
} satisfies Namespace;
