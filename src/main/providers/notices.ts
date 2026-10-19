/**
 * Notices (architecture-notes §12.36): what the person reads and accepts before WA Stay sends
 * a provider anything (`manifest.notice`), such as the risk Stay Rottnest's clause on
 * automated software puts on their own bookings.
 *
 * - **The acceptance** is the `provider_state` row `('<providerId>', 'core.notice')`,
 *   `{ version, acceptedAt }`, read and written here through the repository. A provider's own
 *   `ctx.state` cannot reach `core.*` keys (`sdk/kv-store.ts`), so no provider accepts its own
 *   notice. It counts only at the notice's current version, so a provider that raises the
 *   version asks everyone again. A row that cannot be read counts as not accepted, with a
 *   warning.
 * - **The gate.** Until the notice is accepted, the core sends the provider nothing:
 *   `assertAccepted` refuses a place's check, a new or re-armed watch or snipe, and a snipe's
 *   poll (`NOTICE_REQUIRED`); Explore's bulk search reports the provider as `notice` without
 *   asking it; a watch's run records that it is paused. A provider without a notice is never
 *   gated. The catalogue and a place's details are not gated: a provider that declares a
 *   notice serves them without asking its site (Stay Rottnest's come from a seed).
 * - **Withdrawing** deletes the row and calls `onWithdrawn` (the container drops the
 *   provider's cached availability), so the next check is refused at once.
 */

import type { ProviderNoticeStatus } from '@shared/contracts/providers';
import type { ProviderId, ProviderManifest } from '@shared/types/provider.types';
import type { ProviderStateRepository } from '../database/repositories/provider-state.repository';
import { AppError } from '../utils/app-error';
import type { ProviderRegistry } from './registry';
import type { ProviderLogger } from './sdk/context';

/** The `provider_state` key of the person's acceptance of a provider's notice. */
export const NOTICE_STATE_KEY = 'core.notice';

interface Acceptance {
  version: number;
  acceptedAt: string;
}

function isAcceptance(value: unknown): value is Acceptance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { version, acceptedAt } = value as Record<string, unknown>;
  return (
    Number.isInteger(version) &&
    typeof acceptedAt === 'string' &&
    !Number.isNaN(Date.parse(acceptedAt))
  );
}

/** Why a request to the provider was refused: "Read and accept Stay Rottnest's notice first." */
export function noticeRequiredMessage(manifest: Pick<ProviderManifest, 'shortName'>): string {
  return `Read and accept ${manifest.shortName}'s notice in WA Stay first.`;
}

/** What a watch that could not run records: "Paused: read and accept …". */
export function noticePausedMessage(manifest: Pick<ProviderManifest, 'shortName'>): string {
  return `Paused: read and accept ${manifest.shortName}'s notice in WA Stay.`;
}

export interface ProviderNoticesDeps {
  /** `provider_state`. */
  state: Pick<ProviderStateRepository, 'get' | 'set' | 'delete'>;
  /** Where the providers are registered: their manifests declare the notices. */
  providers: Pick<ProviderRegistry, 'get' | 'tryGet'>;
  /** After a withdrawal: the container drops the provider's cached availability. */
  onWithdrawn?: (providerId: ProviderId) => void;
  logger: ProviderLogger;
  clock?: () => Date;
}

export class ProviderNotices {
  private readonly state: ProviderNoticesDeps['state'];
  private readonly providers: ProviderNoticesDeps['providers'];
  private readonly onWithdrawn: (providerId: ProviderId) => void;
  private readonly logger: ProviderLogger;
  private readonly clock: () => Date;

  constructor(deps: ProviderNoticesDeps) {
    this.state = deps.state;
    this.providers = deps.providers;
    this.onWithdrawn = deps.onWithdrawn ?? (() => undefined);
    this.logger = deps.logger;
    this.clock = deps.clock ?? (() => new Date());
  }

  /**
   * Whether the provider's notice is accepted at its current version. Throws
   * `UnknownProviderError` for a provider that is not registered.
   */
  status(providerId: ProviderId): ProviderNoticeStatus {
    return this.statusOf(this.providers.get(providerId).manifest);
  }

  /**
   * Whether WA Stay may send the provider requests: it has no notice, or its notice is
   * accepted. A provider that is not registered has none (the registry refuses it elsewhere).
   * Never throws.
   */
  isAccepted(providerId: ProviderId): boolean {
    const manifest = this.providers.tryGet(providerId)?.manifest;
    return !manifest || this.statusOf(manifest).accepted;
  }

  /** Throws `NOTICE_REQUIRED` unless `isAccepted`. */
  assertAccepted(providerId: ProviderId): void {
    if (this.isAccepted(providerId)) return;
    const manifest = this.providers.get(providerId).manifest;
    throw new AppError('NOTICE_REQUIRED', noticeRequiredMessage(manifest));
  }

  /**
   * Accepts the provider's notice at `version` and answers its status. Throws
   * `UnknownProviderError`, `NOT_FOUND` when it has no notice, and `VALIDATION` (on
   * `version`) when the person read another version than the current one. Accepting again
   * keeps the first time.
   */
  accept(providerId: ProviderId, version: number): ProviderNoticeStatus {
    const { manifest } = this.providers.get(providerId);
    const { notice } = manifest;
    if (!notice) throw new AppError('NOT_FOUND', `${manifest.shortName} has no notice`);
    if (version !== notice.version) {
      throw new AppError(
        'VALIDATION',
        `${manifest.shortName}'s notice has changed. Read it again.`,
        {
          issues: ['version'],
        }
      );
    }
    const status = this.statusOf(manifest);
    if (status.accepted) return status;
    const now = this.clock();
    const acceptance: Acceptance = { version, acceptedAt: now.toISOString() };
    this.state.set(providerId, NOTICE_STATE_KEY, acceptance, now);
    this.logger.info(`Notice of ${providerId} accepted (version ${version})`);
    return this.statusOf(manifest);
  }

  /**
   * Withdraws the acceptance, so WA Stay stops checking the provider, and answers its status.
   * Throws `UnknownProviderError`; withdrawing what is not accepted changes nothing.
   */
  withdraw(providerId: ProviderId): ProviderNoticeStatus {
    const { manifest } = this.providers.get(providerId);
    if (this.read(providerId) !== undefined) {
      this.state.delete(providerId, NOTICE_STATE_KEY);
      this.logger.info(`Notice of ${providerId} withdrawn`);
    }
    this.onWithdrawn(providerId);
    return this.statusOf(manifest);
  }

  private statusOf(manifest: ProviderManifest): ProviderNoticeStatus {
    const { notice } = manifest;
    if (!notice) return { providerId: manifest.id, required: false, accepted: true };
    const stored = this.read(manifest.id);
    const accepted = stored?.version === notice.version;
    return {
      providerId: manifest.id,
      required: true,
      accepted,
      version: notice.version,
      ...(accepted && stored ? { acceptedAt: stored.acceptedAt } : {}),
    };
  }

  /** The stored acceptance; undefined when there is none or it cannot be read. */
  private read(providerId: ProviderId): Acceptance | undefined {
    let value: unknown;
    try {
      value = this.state.get(providerId, NOTICE_STATE_KEY);
    } catch {
      value = null;
    }
    if (value === undefined) return undefined;
    if (isAcceptance(value)) return value;
    this.logger.warn(`The notice acceptance of ${providerId} is not readable; not accepted`);
    return undefined;
  }
}
