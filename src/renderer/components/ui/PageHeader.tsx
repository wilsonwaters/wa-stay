import type { MouseEvent, ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cx } from './cx';

export interface BackLinkProps {
  /** Where it leads: a hash route, `#/watches`. */
  href: string;
  /** The parent page's name: "Watches", "Explore". */
  children: ReactNode;
  /** To take over the navigation (call `preventDefault`), e.g. to go back one step instead. */
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
}

/**
 * "← Watches": the link back to the parent page, at the top of a page. `PageHeader` renders it
 * from `back`; a page with its own title block (a place's page) uses it directly.
 */
export function BackLink({ href, children, onClick, className }: BackLinkProps) {
  return (
    <a
      href={href}
      onClick={onClick}
      className={cx(
        'inline-flex w-fit items-center gap-1.5 rounded-sm text-sm font-semibold text-brand-strong hover:underline',
        className
      )}
    >
      <ArrowLeft size={16} aria-hidden="true" />
      {children}
    </a>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned actions, usually one primary Button. */
  actions?: ReactNode;
  /** A link back to the parent page, e.g. `{ label: 'Watches', href: '#/watches' }`. */
  back?: { label: string; href: string };
  /**
   * 1 (default): the page's only `h1`. Lower levels are only for specimens such as the
   * `/__design` gallery, where the page already has its `h1`.
   */
  headingLevel?: 1 | 2 | 3;
  /**
   * A picture that leads the title, such as a place's photo: beside it from `sm`, above it on
   * narrow screens. The picture sets its own size.
   */
  media?: ReactNode;
  /**
   * A wide picture between the back link and the title, such as a booking's place photo
   * (Airbnb's trip page). It sets its own size. Use `media` or `hero`, not both.
   */
  hero?: ReactNode;
  className?: string;
}

/**
 * The top of a page: its one `h1`, a line of description, actions, an optional back link, and
 * optionally a picture beside the title (`media`) or above it (`hero`).
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  headingLevel = 1,
  media,
  hero,
  className,
}: PageHeaderProps) {
  const Heading = `h${headingLevel}` as const;
  const titleBlock = (
    <div className="min-w-0 max-w-2xl">
      <Heading className="text-2xl font-semibold text-fg">{title}</Heading>
      {description && <p className="mt-1 text-base text-fg-secondary">{description}</p>}
    </div>
  );
  return (
    <header className={cx('flex flex-col gap-3', className)}>
      {back && <BackLink href={back.href}>{back.label}</BackLink>}
      {hero && <div className="mb-3">{hero}</div>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        {media ? (
          <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-center">
            {media}
            {titleBlock}
          </div>
        ) : (
          titleBlock
        )}
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </header>
  );
}

export default PageHeader;
