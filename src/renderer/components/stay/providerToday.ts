import type { ProviderManifest } from '../../../shared/types/provider.types';
import { todayIn } from '../../../shared/utils/calendar-date';

/**
 * "Today" (`YYYY-MM-DD`) where the provider is, in its manifest's time zone, else on this
 * computer: what a watch's, snipe's or booking's stay is compared with. Pure.
 */
export function providerToday(manifest: ProviderManifest | undefined, now: Date): string {
  const zone = manifest?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return todayIn(zone, now);
}
