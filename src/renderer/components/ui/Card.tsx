import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { cx } from './cx';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

type CardOwnProps<E extends ElementType> = {
  /** The element to render: `div` (default), `article`, `section`, `li`, `a`, `button`… */
  as?: E;
  padding?: CardPadding;
  /** `rest` (default) sits on the page; `floating` sits above it, as the tray's cards do. */
  elevation?: 'rest' | 'floating';
  /** Lifts on hover. Render it as a link or button so it is focusable. */
  interactive?: boolean;
  className?: string;
  children?: ReactNode;
};

export type CardProps<E extends ElementType = 'div'> = CardOwnProps<E> &
  Omit<ComponentPropsWithoutRef<E>, keyof CardOwnProps<E>>;

const PADDING: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

/** A surface on the page (or floating above it): hairline border, shadow, 12 px radius. */
export function Card<E extends ElementType = 'div'>({
  as,
  padding = 'md',
  elevation = 'rest',
  interactive,
  className,
  children,
  ...rest
}: CardProps<E>) {
  const Tag: ElementType = as ?? 'div';
  return (
    <Tag
      className={cx(
        'block rounded-lg border border-border bg-surface text-left text-fg',
        elevation === 'floating' ? 'shadow-pop' : 'shadow-card',
        PADDING[padding],
        interactive &&
          'cursor-pointer transition-shadow duration-fast ease-standard hover:shadow-pop',
        className
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export default Card;
