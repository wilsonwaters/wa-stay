import { useDeleteBooking } from '../../../api';
import type { Booking } from '../../../../shared/types/booking.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { ConfirmDialog, useToast } from '../../../components/ui';

export interface RemoveBookingDialogProps {
  booking: Pick<Booking, 'id' | 'location'>;
  manifest: ProviderManifest | undefined;
  open: boolean;
  onClose: () => void;
  /** After the booking is gone (the detail page goes back to the list). */
  onRemoved?: () => void;
}

/**
 * Asks before a booking leaves WA Stay, saying plainly that nothing is cancelled at the
 * provider. Confirming calls `bookings.delete`; a toast says how it went, and on failure the
 * booking stays.
 */
export function RemoveBookingDialog({
  booking,
  manifest,
  open,
  onClose,
  onRemoved,
}: RemoveBookingDialogProps) {
  const remove = useDeleteBooking();
  const toast = useToast();
  const provider = manifest?.shortName ?? 'the provider';
  const name = booking.location.name;

  const confirm = async () => {
    try {
      await remove.mutateAsync(booking.id);
      toast.success(`Removed ${name} from WA Stay`);
      onClose();
      onRemoved?.();
    } catch (error) {
      onClose();
      toast.error(
        `${name} couldn't be removed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  return (
    <ConfirmDialog
      open={open}
      tone="danger"
      title={`Remove ${name} from WA Stay?`}
      message={`This removes the booking from WA Stay only. It does not cancel it on ${provider}.`}
      confirmLabel="Remove from WA Stay"
      onConfirm={confirm}
      onCancel={onClose}
    />
  );
}

export default RemoveBookingDialog;
