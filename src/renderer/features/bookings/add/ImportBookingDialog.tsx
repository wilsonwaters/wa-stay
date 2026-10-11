import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toApiError, useAccountStatus, useImportBooking, useProvidersWith } from '../../../api';
import type { Booking } from '../../../../shared/types/booking.types';
import { ROUTES } from '../../../app/routes';
import { ProviderPicker } from '../../../components/providers/ProviderPicker';
import { Button, Dialog, Field, Notice, TextField, useToast } from '../../../components/ui';
import { AlreadyAdded } from './AlreadyAdded';
import { REFERENCE_MAX, existingBooking } from './addBookingForm';

export interface ImportBookingDialogProps {
  open: boolean;
  onClose: () => void;
  /** The bookings already here, to catch a reference that was imported or added before. */
  bookings: readonly Booking[];
  onImported: (booking: Booking) => void;
}

const FORM_ID = 'import-booking-form';

interface ImportFormProps extends Omit<ImportBookingDialogProps, 'open'> {
  importBooking: ReturnType<typeof useImportBooking>;
}

/** The form's state lives here, so it starts afresh each time the dialog opens. */
function ImportForm({ onClose, bookings, onImported, importBooking }: ImportFormProps) {
  const importers = useProvidersWith('bookingImport');
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [providerId, setProviderId] = useState<string>();
  const [reference, setReference] = useState('');
  const [referenceError, setReferenceError] = useState<string>();
  const [duplicate, setDuplicate] = useState<Booking | null>(null);
  const [failure, setFailure] = useState<string>();
  const [providerMissing, setProviderMissing] = useState(false);
  const manifest = importers.data?.find((m) => m.id === providerId);
  const account = useAccountStatus(providerId);
  const signedOut =
    manifest?.capabilities.account === 'required' && account.data?.status === 'signed-out';

  const choose = useCallback((id: string) => {
    setProviderId(id);
    setProviderMissing(false);
    setDuplicate(null);
    setFailure(undefined);
  }, []);

  const submit = async () => {
    if (!providerId || !manifest) {
      setProviderMissing(true);
      return;
    }
    const ref = reference.trim();
    const problem = !ref
      ? 'Enter the booking reference'
      : ref.length > REFERENCE_MAX
        ? `Use ${REFERENCE_MAX} characters or fewer`
        : undefined;
    const already = ref ? existingBooking(bookings, providerId, ref) : undefined;
    setReferenceError(problem);
    setDuplicate(already ?? null);
    setFailure(undefined);
    if (problem || already) {
      input.current?.focus();
      return;
    }
    try {
      const booking = await importBooking.mutateAsync({ providerId, reference: ref });
      toast.success(`Imported ${booking.location.name}`);
      onClose();
      onImported(booking);
    } catch (error) {
      // The dialog stays open with the reference kept, so the person can try again.
      setFailure(toApiError(error).message);
    }
  };

  return (
    <form
      id={FORM_ID}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-6"
    >
      <ProviderPicker
        capability="bookingImport"
        label="Provider"
        hint="Only providers that can look a booking up are listed."
        value={providerId}
        onChange={choose}
        emptyMessage="No provider can import bookings yet"
      />
      {providerMissing && <Notice tone="warning">Choose a provider to continue.</Notice>}
      {manifest && (
        <Field
          label="Booking reference"
          hint={`Find it in your ${manifest.shortName} confirmation email.`}
          error={duplicate ? <AlreadyAdded booking={duplicate} onOpen={onClose} /> : referenceError}
          required
        >
          <TextField
            ref={input}
            autoComplete="off"
            spellCheck={false}
            value={reference}
            onChange={(event) => {
              setReference(event.target.value);
              setReferenceError(undefined);
              setDuplicate(null);
            }}
          />
        </Field>
      )}
      {manifest && signedOut && (
        <Notice tone="warning" title={`Sign in to ${manifest.shortName} first`}>
          {manifest.shortName} needs your account to look a booking up.{' '}
          <Link
            to={ROUTES.settings('accounts', { provider: manifest.id })}
            onClick={onClose}
            className="font-semibold underline underline-offset-2"
          >
            Connect {manifest.shortName}
          </Link>
        </Notice>
      )}
      {failure && (
        <Notice tone="danger" title="The booking couldn't be imported">
          {failure}
        </Notice>
      )}
    </form>
  );
}

/**
 * "Import booking": only for providers with `capabilities.bookingImport` (the page renders
 * the button only when one exists). The provider, then the reference; `bookings.import`
 * fetches the rest from the provider.
 */
export function ImportBookingDialog({
  open,
  onClose,
  bookings,
  onImported,
}: ImportBookingDialogProps) {
  const importBooking = useImportBooking();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import booking"
      description="WA Stay looks the booking up on the provider's site and adds it here."
      closeOnOverlayClick={false}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={importBooking.isPending}>
            Import booking
          </Button>
        </>
      }
    >
      <ImportForm
        onClose={onClose}
        bookings={bookings}
        onImported={onImported}
        importBooking={importBooking}
      />
    </Dialog>
  );
}

export default ImportBookingDialog;
