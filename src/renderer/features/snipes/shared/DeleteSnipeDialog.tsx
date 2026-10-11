import { SnipeStatus } from '../../../../shared/types/common.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { ConfirmDialog } from '../../../components/ui';

export interface DeleteSnipeDialogProps {
  snipe: Pick<SiteSnipe, 'name' | 'status'>;
  /** The provider's short name, for the held warning. */
  provider: string;
  open: boolean;
  /** Deletes the snipe; a rejection keeps the dialog open and shows its message. */
  onConfirm: () => Promise<unknown>;
  onCancel: () => void;
}

/**
 * Asks before a snipe is deleted. Deleting a held snipe only forgets it here: the hold stays on
 * the provider until it runs out, and the dialog says so.
 */
export function DeleteSnipeDialog({
  snipe,
  provider,
  open,
  onConfirm,
  onCancel,
}: DeleteSnipeDialogProps) {
  const held = snipe.status === SnipeStatus.HELD;
  return (
    <ConfirmDialog
      open={open}
      tone="danger"
      title={`Delete ${snipe.name}?`}
      message={
        held
          ? `Deleting does not release the hold on ${provider}. It stays there until it runs out, and you can still pay for it on ${provider}.`
          : "This stops the snipe and removes it. You can't undo this."
      }
      confirmLabel="Delete snipe"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

export default DeleteSnipeDialog;
