import { useRef, useState } from 'react';
import { Hammer } from 'lucide-react';
import { Notice } from './ui';

export interface ComingSoonBannerProps {
  /** The feature's name as the nav shows it: "Bookings", "Site Sniper". */
  featureName: string;
  /** Overrides the localStorage key; the default is `comingSoonDismissed_<Feature_Name>`. */
  storageKey?: string;
}

/** The key earlier versions stored a dismissal under, so a dismissed banner stays dismissed. */
export function comingSoonStorageKey(featureName: string): string {
  return `comingSoonDismissed_${featureName.replace(/\s+/g, '_')}`;
}

function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeDismissed(key: string): void {
  try {
    window.localStorage.setItem(key, 'true');
  } catch {
    // Storage blocked: the banner still hides for this visit.
  }
}

/**
 * Says a feature that keeps its "Soon" pill (stakeholder decision D4) works but is still being
 * finished. Dismissed once, it stays hidden: the choice is kept in localStorage under the key
 * format earlier versions used. On dismissal, focus moves to the page's heading rather than
 * falling to the body.
 */
export function ComingSoonBanner({ featureName, storageKey }: ComingSoonBannerProps) {
  const key = storageKey ?? comingSoonStorageKey(featureName);
  const [dismissed, setDismissed] = useState(() => readDismissed(key));
  const ref = useRef<HTMLDivElement>(null);

  if (dismissed) return null;

  const dismiss = () => {
    writeDismissed(key);
    const heading = ref.current?.closest('main')?.querySelector<HTMLElement>('h1');
    setDismissed(true);
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus();
    }
  };

  return (
    <div ref={ref}>
      <Notice
        tone="info"
        icon={Hammer}
        onDismiss={dismiss}
        dismissLabel={`Dismiss the ${featureName} notice`}
      >
        <span className="font-semibold">{featureName} is still being finalised.</span> It works, but
        expect rough edges.
      </Notice>
    </div>
  );
}

export default ComingSoonBanner;
