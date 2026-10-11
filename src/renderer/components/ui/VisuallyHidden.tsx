import type { ElementType, HTMLAttributes, ReactNode } from 'react';

export interface VisuallyHiddenProps extends HTMLAttributes<HTMLElement> {
  /** The element to render. Defaults to `span`. */
  as?: ElementType;
  children: ReactNode;
}

/** Content for screen readers only: hidden visually, still in the accessibility tree. */
export function VisuallyHidden({ as: Tag = 'span', children, ...rest }: VisuallyHiddenProps) {
  return (
    <Tag className="sr-only" {...rest}>
      {children}
    </Tag>
  );
}

export default VisuallyHidden;
