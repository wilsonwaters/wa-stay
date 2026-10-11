import type { Watch } from '../../../../shared/types/watch.types';
import { ConfirmDialog } from '../../../components/ui';

export interface DeleteWatchDialogProps {
  watch: Pick<Watch, 'name'>;
  open: boolean;
  /** Deletes the watch; a rejection keeps the dialog open and shows its message. */
  onConfirm: () => Promise<unknown>;
  onCancel: () => void;
}

/** Asks before a watch is deleted, in the design system's ConfirmDialog. */
export function DeleteWatchDialog({ watch, open, onConfirm, onCancel }: DeleteWatchDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      tone="danger"
      title={`Delete ${watch.name}?`}
      message="This stops the watch and removes its results. You can't undo this."
      confirmLabel="Delete watch"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

export default DeleteWatchDialog;
