import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, ButtonBase } from './Button';
import { Dialog } from './Dialog';
import { Notice } from './Notice';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` (default) uses the solid deep-crimson confirm and focuses Cancel first. */
  tone?: 'danger' | 'primary';
  /**
   * May return a Promise: the confirm button shows loading until it settles. If it rejects,
   * the dialog stays open and shows the error (the Error's message, or a generic line).
   */
  onConfirm: () => void | Promise<unknown>;
  onCancel: () => void;
}

const FALLBACK_ERROR = "That didn't work. Try again.";

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : FALLBACK_ERROR;
}

/**
 * "Are you sure?" built on Dialog, as an `alertdialog`. The parent closes it (sets `open`
 * to false) when the action is done; while an async confirm runs, it cannot be dismissed.
 * A rejected confirm is caught (never an unhandled rejection): the dialog stays open with
 * the error shown as an alert, and the person can try again or cancel.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (open) return;
    setBusy(false);
    setError(null);
  }, [open]);

  const confirm = async () => {
    setError(null);
    let result: void | Promise<unknown>;
    try {
      result = onConfirm();
    } catch (thrown) {
      setError(errorText(thrown));
      return;
    }
    if (!result || typeof (result as Promise<unknown>).then !== 'function') return;
    setBusy(true);
    try {
      await result;
    } catch (rejected) {
      if (mounted.current) setError(errorText(rejected));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      size="sm"
      role="alertdialog"
      hideCloseButton
      closeOnEsc={!busy}
      closeOnOverlayClick={!busy}
      initialFocusRef={tone === 'danger' ? cancelRef : confirmRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <ButtonBase
            ref={confirmRef}
            variant={tone === 'danger' ? 'danger-solid' : 'primary'}
            loading={busy}
            onClick={confirm}
          >
            {confirmLabel}
          </ButtonBase>
        </>
      }
    >
      {error && <Notice tone="danger">{error}</Notice>}
    </Dialog>
  );
}

export default ConfirmDialog;
