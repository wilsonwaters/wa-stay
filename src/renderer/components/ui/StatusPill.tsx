import type { LucideIcon } from 'lucide-react';
import { BADGE_TONE_CLASS, type BadgeTone } from './Badge';
import { cx } from './cx';

export interface StatusPillProps {
  tone: BadgeTone;
  icon: LucideIcon;
  label: string;
  /** A pulsing dot for work in progress (watching, sniping). Static under reduced motion. */
  live?: boolean;
  className?: string;
}

/** A status: icon, label and tone together, so colour never carries it alone. */
export function StatusPill({ tone, icon: Icon, label, live, className }: StatusPillProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold',
        BADGE_TONE_CLASS[tone],
        className
      )}
    >
      {live ? (
        <span aria-hidden="true" className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-current opacity-60 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
        </span>
      ) : (
        <Icon size={14} aria-hidden="true" />
      )}
      {label}
    </span>
  );
}

export default StatusPill;
