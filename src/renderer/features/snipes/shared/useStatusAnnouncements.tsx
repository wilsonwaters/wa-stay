import { useEffect, useRef, useState } from 'react';
import { SnipeStatus } from '../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { useAnnounce } from '../../../components/ui';
import { statusPillFor, unitNounFor } from './snipeState';

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "Site held at Osprey Bay. Pay within 23 minutes." */
export function heldMessage(
  snipe: SiteSnipe,
  manifest: ProviderManifest | undefined,
  now = Date.now()
) {
  const unit = capitalise(unitNounFor(manifest).one);
  const place = snipe.location.name || snipe.name;
  if (!snipe.holdExpiresAt) {
    return `${unit} held at ${place}. Pay on ${manifest?.shortName ?? 'the provider'} before the hold runs out.`;
  }
  const minutes = Math.max(1, Math.ceil((new Date(snipe.holdExpiresAt).getTime() - now) / 60_000));
  return `${unit} held at ${place}. Pay within ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

/**
 * Announces each status change once, as it arrives (not on the first load): politely ("Osprey
 * Bay weekend: Waiting for release"), except a hold, which is urgent and goes in the returned
 * alert text for a `role="alert"` region ("Site held at Osprey Bay. Pay within 23 minutes.").
 */
export function useStatusAnnouncements(
  snipes: readonly SiteSnipe[] | undefined,
  manifestOf: (providerId: string) => ProviderManifest | undefined
): string {
  const announce = useAnnounce();
  const seen = useRef<Map<number, string>>(undefined);
  const [alert, setAlert] = useState('');

  useEffect(() => {
    if (!snipes) return;
    const previous = seen.current;
    seen.current = new Map(snipes.map((snipe) => [snipe.id, snipe.status]));
    if (!previous) return;
    for (const snipe of snipes) {
      const before = previous.get(snipe.id);
      if (before === undefined || before === snipe.status) continue;
      if (snipe.status === SnipeStatus.HELD)
        setAlert(heldMessage(snipe, manifestOf(snipe.providerId)));
      else announce(`${snipe.name}: ${statusPillFor(snipe.status).label}`);
    }
  }, [snipes, manifestOf, announce]);

  return alert;
}

/** The urgent region a hold is announced in; visually hidden (the hold panel shows it). */
export function HoldAlert({ message }: { message: string }) {
  return (
    <div role="alert" className="sr-only">
      {message}
    </div>
  );
}
