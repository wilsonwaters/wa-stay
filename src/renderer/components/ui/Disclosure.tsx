import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from './cx';
import { useDisclosure, type UseDisclosureOptions } from './useDisclosure';

export interface DisclosureProps extends UseDisclosureOptions {
  /** The always-visible button text, e.g. "Advanced options". */
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  /**
   * Wraps the button in a heading of this level, for a disclosure that titles a part of the
   * page (a place's "Booking" or "Fees"), so it is in the page's outline. None by default.
   */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** `sm` (the default) for optional detail; `md` for a part of the page's text. */
  size?: 'sm' | 'md';
}

const SIZE = {
  sm: { button: 'py-2 text-sm', panel: 'pb-2 pt-1 text-sm' },
  md: { button: 'py-3 text-base', panel: 'pb-4 pt-1 text-base' },
} as const;

/**
 * Show and hide a region with a button (`aria-expanded`, `aria-controls`). The chevron points
 * up when open; under reduced motion the global rule removes the turning animation, not the
 * state.
 */
export function Disclosure({
  summary,
  children,
  className,
  headingLevel,
  size = 'sm',
  ...options
}: DisclosureProps) {
  const { open, buttonProps, panelProps } = useDisclosure(options);
  const button = (
    <button
      {...buttonProps}
      className={cx(
        'flex w-full items-center justify-between gap-3 rounded-md text-left font-semibold text-fg hover:text-brand-strong',
        SIZE[size].button
      )}
    >
      <span>{summary}</span>
      <ChevronDown
        size={18}
        aria-hidden="true"
        className={cx(
          'shrink-0 transition-transform duration-base ease-standard',
          open && 'rotate-180'
        )}
      />
    </button>
  );
  const Heading = headingLevel ? (`h${headingLevel}` as const) : undefined;
  return (
    <div className={className}>
      {Heading ? <Heading>{button}</Heading> : button}
      <div {...panelProps} className={cx('text-fg-secondary', SIZE[size].panel)}>
        {children}
      </div>
    </div>
  );
}

export default Disclosure;
