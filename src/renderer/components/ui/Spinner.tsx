import { LoaderCircle } from 'lucide-react';
import { cx } from './cx';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps {
  /** Read by screen readers; never shown. */
  label?: string;
  size?: SpinnerSize;
  className?: string;
}

const ICON_SIZE: Record<SpinnerSize, number> = { sm: 16, md: 24, lg: 40 };

/**
 * A loading indicator for waits longer than about 300 ms. `role="status"`, named by `label`,
 * with the same text visually hidden inside so it is also announced. Lay it out with the parent; there is no full-screen mode.
 */
export function Spinner({ label = 'Loading', size = 'md', className }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className={cx('inline-flex text-brand', className)}>
      <LoaderCircle size={ICON_SIZE[size]} className="animate-spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export default Spinner;
