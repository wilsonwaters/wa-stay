import type { ReactNode } from 'react';
import { cx } from './cx';

export type BadgeTone = 'neutral' | 'brand' | 'accent' | 'available' | 'warning' | 'danger' | 'sun';

/** Each tone is a CONTRAST_PAIRS text pair (4.5:1 or more). */
export const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'bg-surface-subtle text-fg-secondary',
  brand: 'bg-brand-subtle text-brand-strong',
  accent: 'bg-accent-subtle text-accent-hover',
  available: 'bg-available-subtle text-available-fg',
  warning: 'bg-warning-subtle text-warning-fg',
  danger: 'bg-danger-subtle text-danger-fg',
  sun: 'bg-sun-subtle text-warning-fg',
};

export interface BadgeProps {
  tone?: BadgeTone;
  /** Optional decorative icon at 14–16 px. The text carries the meaning. */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A small label. Always text, so the tone colour is never the only signal. */
export function Badge({ tone = 'neutral', icon, children, className }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold',
        BADGE_TONE_CLASS[tone],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export default Badge;
