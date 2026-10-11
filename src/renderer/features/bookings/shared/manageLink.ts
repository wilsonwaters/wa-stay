/**
 * Where "Manage on {shortName}" goes (architecture-notes §12.5, OQ4): the booking's own
 * `manageUrl` (the provider's bookings page), else the provider's website, else nowhere.
 * An unregistered provider gets no link at all. Pure.
 */
import type { Booking } from '../../../../shared/types/booking.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';

export interface ManageLink {
  href: string;
  /** "Manage on ParkStay". */
  label: string;
}

/** Only secure web addresses: `http:`, `javascript:` or `file:` is never offered as a link. */
function webAddress(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function manageLinkFor(
  booking: Pick<Booking, 'manageUrl'>,
  manifest: ProviderManifest | undefined
): ManageLink | null {
  if (!manifest) return null;
  const href = webAddress(booking.manageUrl) ?? webAddress(manifest.website);
  return href ? { href, label: `Manage on ${manifest.shortName}` } : null;
}
