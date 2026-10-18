/**
 * Stay Rottnest's release policy, for Open Day plans (§12.38): Site Sniper's only mode here is
 * `open_day`, a reminder-only mode (`manifest.ts`), so a plan reminds the person before the
 * Open Day that opens their stay and never checks, waits in the waiting room or books
 * (`ai-state/research/rottnest-terms.md` §9.9). Pure: no request.
 *
 * - **`computeReleaseAt`**: the stay's Open Day at 8:30 am Perth, by its release status
 *   (`release.ts`, the 5/3 rule included). A stay the booking rules refuse, or one already on
 *   sale, is refused in a sentence (a `ProviderError`, which the core turns into `VALIDATION`
 *   on the release).
 * - **`describe`**: how Stay Rottnest's stays go on sale, and the next Open Day.
 */

import { SnipeReleaseMode } from '@shared/types/common.types';
import type { ProviderContext } from '../sdk/context';
import { ProviderError, throwIfAborted } from '../sdk/errors';
import type { ReleasePolicy, StayRulesModule } from '../sdk/provider';
import { describeOpenDays } from './release';

/** Why a plan can't be made for a stay already on sale. */
export const ALREADY_ON_SALE =
  'These dates are already on sale: book them on Stay Rottnest now, or set a watch for a cancellation.';

export function createRottnestReleasePolicy(
  ctx: Pick<ProviderContext, 'id' | 'clock'>,
  rules: StayRulesModule
): ReleasePolicy {
  return {
    supports: (mode) => mode === SnipeReleaseMode.OPEN_DAY,

    async computeReleaseAt({ mode, externalId, stay, unitIds, unitKinds, now, signal }) {
      throwIfAborted(signal);
      // Nothing is sent; still settle after the caller could abort
      await Promise.resolve();
      throwIfAborted(signal);
      if (mode !== SnipeReleaseMode.OPEN_DAY) {
        throw new ProviderError({ providerId: ctx.id, message: `Unknown release mode ${mode}` });
      }
      const verdict = rules.check({
        externalId,
        stay,
        ...(unitIds?.length ? { unitIds } : {}),
        ...(unitKinds?.length ? { unitKinds } : {}),
        now,
      });
      if (!verdict.ok) throw new ProviderError({ providerId: ctx.id, message: verdict.reason });
      const release = verdict.release;
      if (!release || release.open || !release.opensAt) {
        throw new ProviderError({ providerId: ctx.id, message: ALREADY_ON_SALE });
      }
      return new Date(release.opensAt);
    },

    describe: async () => describeOpenDays(ctx.clock()),

    // Never polled: a plan only reminds
    pollFloorMs: { window: 60_000, continuous: 60_000 },
  };
}
