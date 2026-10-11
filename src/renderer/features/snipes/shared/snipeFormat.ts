/**
 * How a snipe's choices read (pure): a provider stay field's value, and its release in words.
 */
import { SnipeReleaseMode } from '../../../../shared/types/common.types';
import { buildPath, PATTERNS } from '../../../app/routes';
import type {
  ProviderManifest,
  StayFieldDescriptor,
} from '../../../../shared/types/provider.types';
import { timeInZone } from '../../../components/timeFormat';

/** A provider stay field's value as chosen ("Tent", "Yes", "Not given"). */
export function stayFieldText(field: StayFieldDescriptor, value: unknown): string {
  const option = field.options?.find((o) => o.value === value)?.label;
  if (option) return option;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return value === undefined || value === '' ? 'Not given' : String(value);
}

/** The provider's name for a release mode ("When new dates open"), or the raw id. */
export function releaseModeLabel(manifest: ProviderManifest | undefined, mode: string): string {
  return manifest?.releaseModes?.find((m) => m.id === mode)?.label ?? mode;
}

/**
 * "At a scheduled time: Tue 3 Nov, 10:00 am AWST", "When someone cancels", or a computed mode
 * with the time main worked out ("When new dates open: Mon 13 Oct, 12:00 am AWST").
 */
export function releaseText(
  manifest: ProviderManifest | undefined,
  mode: string,
  releaseAt: Date | undefined,
  now: Date
): string {
  const label = releaseModeLabel(manifest, mode);
  if (mode === SnipeReleaseMode.CANCELLATION || !releaseAt) return label;
  return `${label}: ${timeInZone(releaseAt, manifest?.timezone ?? 'Australia/Perth', now)}`;
}

/**
 * Where a booked snipe's booking is: the Bookings list searched for its reference
 * (`/bookings?q=PB123`), or the whole list when the reference is not known.
 */
export function bookingHref(bookedReference: string | undefined): string {
  return buildPath(PATTERNS.bookings, {}, { q: bookedReference });
}
