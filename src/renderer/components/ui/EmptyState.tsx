import type { ReactNode } from 'react';
import { Brushstroke } from './Brushstroke';
import { cx } from './cx';

export interface EmptyStateProps {
  /** A lucide icon at 24 px, e.g. `<BellRing size={24} />`. Decorative. */
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** Usually one Button: the next step. */
  actions?: ReactNode;
  /** The sparing brushstroke accent above the title (at most one per region). */
  accent?: 'sun' | 'ocean';
  /** 1 when the empty state is the whole page (its only heading), as on a missing place. */
  headingLevel?: 1 | 2 | 3;
  /**
   * `lg` (default): a Fraunces display title, for an empty state that is the whole view.
   * `md`: a Figtree section title (`text-xl`), for one under the page's `h1`, so it never
   * outranks the page title.
   */
  size?: 'lg' | 'md';
  className?: string;
}

const TITLE_CLASS = {
  lg: 'font-display text-display-sm font-medium',
  md: 'text-xl font-semibold',
} as const;

/** What to show when there is nothing yet, and what to do about it. */
export function EmptyState({
  icon,
  title,
  description,
  actions,
  accent,
  headingLevel = 2,
  size = 'lg',
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={cx(
        'mx-auto flex max-w-md flex-col items-center px-6 py-12 text-center',
        className
      )}
    >
      {icon && (
        <span
          aria-hidden="true"
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-subtle text-fg-secondary"
        >
          {icon}
        </span>
      )}
      {accent && <Brushstroke variant="swash" tone={accent} className="mb-3 h-5 w-32" />}
      <Heading className={cx(TITLE_CLASS[size], 'text-fg')}>{title}</Heading>
      {description && <p className="mt-2 text-base text-fg-secondary">{description}</p>}
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-3">{actions}</div>}
    </div>
  );
}

export default EmptyState;
