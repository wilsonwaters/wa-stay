import { useEffect, useRef, useState } from 'react';
import { usePlaceUnitsLoader } from '../../../api';
import type { UnitSummary } from '../../../../shared/types/catalog.types';
import { SnipeStatus } from '../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { useAnnounce } from '../../../components/ui';
import { capitalise } from '../../../../shared/utils/unit-noun';
import { heldUnitNoun } from './snipeNouns';
import { alertedMessage } from './snipeAlert';
import { statusPillFor } from './snipeState';

/**
 * "Site held at Osprey Bay. Pay within 23 minutes.", with the held unit named by its kind among
 * the place's `units` (as its pill and hold panel name it) when they are known.
 */
export function heldMessage(
  snipe: SiteSnipe,
  manifest: ProviderManifest | undefined,
  now = Date.now(),
  units?: readonly UnitSummary[]
) {
  const unit = capitalise(heldUnitNoun(snipe, manifest, units).one);
  const place = snipe.location.name || snipe.name;
  if (!snipe.holdExpiresAt) {
    return `${unit} held at ${place}. Pay on ${manifest?.shortName ?? 'the booking site'} before the hold runs out.`;
  }
  const minutes = Math.max(1, Math.ceil((new Date(snipe.holdExpiresAt).getTime() - now) / 60_000));
  // A guessed expiry is "about" (R18)
  const about = snipe.holdExpiresEstimated ? 'about ' : '';
  return `${unit} held at ${place}. Pay within ${about}${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

/**
 * Announces each status change once, as it arrives (not on the first load): politely ("Osprey
 * Bay weekend: Waiting for release"; an alert says what is free, `alertedMessage`), except a
 * hold, which is urgent and goes in the returned alert text for a `role="alert"` region ("Site
 * held at Osprey Bay. Pay within 23 minutes.").
 * The held unit is named as its pill and hold panel name it, from the place's units: at once
 * when they are cached; else the alert is said at once, and again if the units, once loaded,
 * name it otherwise.
 */
export function useStatusAnnouncements(
  snipes: readonly SiteSnipe[] | undefined,
  manifestOf: (providerId: string) => ProviderManifest | undefined
): string {
  const announce = useAnnounce();
  const placeUnits = usePlaceUnitsLoader();
  const seen = useRef<Map<number, string>>(undefined);
  const [alert, setAlert] = useState('');
  /** Counts the holds announced, so a late name never replaces a newer alert. */
  const lastAlert = useRef(0);

  useEffect(() => {
    if (!snipes) return;
    const previous = seen.current;
    seen.current = new Map(snipes.map((snipe) => [snipe.id, snipe.status]));
    if (!previous) return;
    for (const snipe of snipes) {
      const before = previous.get(snipe.id);
      if (before === undefined || before === snipe.status) continue;
      const manifest = manifestOf(snipe.providerId);
      if (snipe.status === SnipeStatus.HELD) {
        const units = placeUnits(snipe.locationKey);
        const said = (lastAlert.current += 1);
        if (Array.isArray(units)) {
          setAlert(heldMessage(snipe, manifest, Date.now(), units));
        } else {
          // Said at once (it is urgent), and said again only if the units name it otherwise
          setAlert(heldMessage(snipe, manifest));
          void Promise.resolve(units).then((loaded) => {
            const renamed =
              heldUnitNoun(snipe, manifest, loaded).one !== heldUnitNoun(snipe, manifest).one;
            if (renamed && lastAlert.current === said) {
              setAlert(heldMessage(snipe, manifest, Date.now(), loaded));
            }
          });
        }
      } else if (snipe.status === SnipeStatus.ALERTED) {
        announce(alertedMessage(snipe, manifest));
      } else {
        announce(
          `${snipe.name}: ${statusPillFor(snipe.status, heldUnitNoun(snipe, manifest)).label}`
        );
      }
    }
  }, [snipes, manifestOf, announce, placeUnits]);

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
