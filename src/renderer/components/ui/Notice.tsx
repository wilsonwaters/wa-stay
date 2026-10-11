import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { IconButton } from './IconButton';
import { cx } from './cx';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const TONE: Record<NoticeTone, { className: string; icon: LucideIcon }> = {
  info: { className: 'border-brand/30 bg-brand-subtle text-brand-strong', icon: Info },
  success: {
    className: 'border-available/30 bg-available-subtle text-available-fg',
    icon: CircleCheck,
  },
  warning: {
    className: 'border-warning-fg/30 bg-warning-subtle text-warning-fg',
    icon: TriangleAlert,
  },
  danger: { className: 'border-danger/30 bg-danger-subtle text-danger-fg', icon: CircleAlert },
};

export interface NoticeProps {
  tone?: NoticeTone;
  title?: ReactNode;
  /** Replaces the tone's icon when another says it better (`Clock` for booking rules). */
  icon?: LucideIcon;
  children?: ReactNode;
  /** Buttons or links after the message, e.g. "Try again". */
  actions?: ReactNode;
  /** Shows a Dismiss button when given. */
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
}

/**
 * An inline banner. `role="status"`, or `role="alert"` for danger. The icon and text carry the
 * tone, never the colour alone.
 */
export function Notice({
  tone = 'info',
  title,
  icon,
  children,
  actions,
  onDismiss,
  dismissLabel = 'Dismiss',
  className,
}: NoticeProps) {
  const { className: toneClass, icon: toneIcon } = TONE[tone];
  const Icon = icon ?? toneIcon;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('flex items-start gap-3 rounded-lg border p-4', toneClass, className)}
    >
      <Icon size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-1' : undefined}>{children}</div>}
        {actions && <div className="mt-3 flex flex-wrap gap-3">{actions}</div>}
      </div>
      {onDismiss && (
        <IconButton
          label={dismissLabel}
          icon={<X size={16} />}
          size="sm"
          onClick={onDismiss}
          className="-m-1"
        />
      )}
    </div>
  );
}

export default Notice;
