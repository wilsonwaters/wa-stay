import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import { Portal } from './Portal';
import { useOverlay } from './OverlayStack';
import { cx } from './cx';
import { useFocusTrap } from './useFocusTrap';

export type DialogSize = 'sm' | 'md' | 'lg' | 'full';

export interface DialogProps {
  open: boolean;
  /** Called by Escape, the overlay and the close button. The parent sets `open` to false. */
  onClose: () => void;
  /** The dialog's accessible name. */
  title: ReactNode;
  /** Read after the title as the dialog's description. */
  description?: ReactNode;
  children?: ReactNode;
  /** Actions, right-aligned under the content. */
  footer?: ReactNode;
  size?: DialogSize;
  closeOnEsc?: boolean;
  closeOnOverlayClick?: boolean;
  /** Focused on open. Default: the first focusable element, skipping the close button. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  hideCloseButton?: boolean;
  /** `alertdialog` for confirmations that interrupt (ConfirmDialog). */
  role?: 'dialog' | 'alertdialog';
  className?: string;
}

interface DialogFrameProps extends DialogProps {
  placement: 'center' | 'right';
}

const CENTER_SIZE: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  full: 'h-full max-w-none',
};

const SHEET_SIZE: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-xl',
  full: 'max-w-none',
};

/** Shared by Dialog and Sheet: portal, scrim, focus trap, Escape and the overlay stack. */
export function DialogFrame({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnEsc = true,
  closeOnOverlayClick = true,
  initialFocusRef,
  hideCloseButton,
  role = 'dialog',
  className,
  placement,
}: DialogFrameProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useOverlay({
    open,
    modal: true,
    elementRef: rootRef,
    onEscape: closeOnEsc ? onClose : undefined,
  });
  useFocusTrap(panelRef, { active: open, initialFocusRef });

  if (!open) return null;

  const sheet = placement === 'right';
  return (
    <Portal>
      <div
        ref={rootRef}
        className={cx(
          'fixed inset-0 z-overlay flex',
          sheet ? 'justify-end' : 'items-center justify-center p-4 sm:p-8'
        )}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 animate-fade-in bg-surface-inverse/40"
          // Keep focus in the dialog when the scrim is pressed.
          onMouseDown={(event) => event.preventDefault()}
          onClick={closeOnOverlayClick ? onClose : undefined}
        />
        <div
          ref={panelRef}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={cx(
            'relative flex w-full flex-col bg-surface text-fg shadow-modal focus:outline-hidden',
            sheet
              ? cx('h-full animate-fade-in rounded-l-xl', SHEET_SIZE[size])
              : cx('max-h-full animate-scale-in rounded-xl', CENTER_SIZE[size]),
            className
          )}
        >
          <div className="flex items-start gap-4 px-6 pt-5">
            <h2 id={titleId} className="min-w-0 flex-1 pt-1.5 text-lg font-semibold text-fg">
              {title}
            </h2>
            {!hideCloseButton && (
              <IconButton
                label="Close"
                icon={<X />}
                onClick={onClose}
                className="-mr-2"
                data-skip-initial-focus=""
              />
            )}
          </div>
          {description && (
            <div id={descriptionId} className="px-6 pt-1 text-base text-fg-secondary">
              {description}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
          {footer && (
            <div className="flex flex-wrap justify-end gap-3 border-t border-border px-6 py-4">
              {footer}
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

/**
 * A modal dialog: `role="dialog"`, `aria-modal`, named by its title. Focus is trapped
 * inside and returns to the opener; Escape and the overlay close it; `#root` is inert and
 * the page does not scroll while it is open.
 */
export function Dialog(props: DialogProps) {
  return <DialogFrame {...props} placement="center" />;
}

export default Dialog;
