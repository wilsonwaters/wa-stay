import { cx } from './cx';

export interface SkeletonProps {
  /**
   * `text` is a 12 px line, `circle` an avatar, `rect` (default) a block. `fill` has no corners
   * of its own: it fills a frame that clips it, such as a photo's. Size it with className.
   */
  shape?: 'rect' | 'text' | 'circle' | 'fill';
  className?: string;
}

const SHAPE: Record<NonNullable<SkeletonProps['shape']>, string> = {
  rect: 'rounded-md',
  text: 'h-3 rounded-sm',
  circle: 'rounded-full',
  fill: '',
};

/**
 * A placeholder the size of the content that is loading. Decorative (`aria-hidden`); pair it
 * with a Spinner or `aria-busy` on the region so the wait is announced. Static under reduced motion.
 */
export function Skeleton({ shape = 'rect', className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'block animate-shimmer bg-linear-to-r from-surface-subtle via-canvas to-surface-subtle bg-size-[200%_100%]',
        SHAPE[shape],
        className
      )}
    />
  );
}

export default Skeleton;
