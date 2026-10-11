import { useCallback, useState } from 'react';
import { toApiError, useCreateBooking, useProviders } from '../../../api';
import type { Booking } from '../../../../shared/types/booking.types';
import { ProviderPicker } from '../../../components/providers/ProviderPicker';
import { StepFlow } from '../../../components/StepFlow';
import { Dialog, Notice, useToast } from '../../../components/ui';
import { AlreadyAdded } from './AlreadyAdded';
import { BookingDetailsFields } from './BookingDetailsFields';
import {
  emptyBookingValues,
  existingBooking,
  toBookingInput,
  validateDetails,
  type AddBookingErrors,
  type AddBookingField,
  type AddBookingValues,
} from './addBookingForm';

export interface AddBookingDialogProps {
  open: boolean;
  onClose: () => void;
  /** The bookings already here, to catch a reference that was added before. */
  bookings: readonly Booking[];
  /** The new booking, once main has stored it. */
  onAdded: (booking: Booking) => void;
}

const STEPS = [
  { id: 'provider', title: 'Provider' },
  { id: 'details', title: 'Details' },
];

type Step = 'provider' | 'details';

/** Which message each value's field shows. */
const FIELD_OF: Partial<Record<keyof AddBookingValues, AddBookingField>> = {
  location: 'location',
  locationName: 'location',
  arrival: 'dates',
  departure: 'dates',
  adults: 'adults',
  children: 'adults',
  infants: 'adults',
  unit: 'unit',
  reference: 'reference',
  totalCost: 'totalCost',
  notes: 'notes',
};

/** The flow's state lives here, so it starts afresh each time the dialog opens. */
function AddBookingFlow({ onClose, bookings, onAdded }: Omit<AddBookingDialogProps, 'open'>) {
  const providers = useProviders();
  const create = useCreateBooking();
  const toast = useToast();
  const [step, setStep] = useState<Step>('provider');
  const [values, setValues] = useState<AddBookingValues>(() => emptyBookingValues());
  const [errors, setErrors] = useState<AddBookingErrors>({});
  const [duplicate, setDuplicate] = useState<Booking | null>(null);
  const [providerMissing, setProviderMissing] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const manifest = providers.data?.find((m) => m.id === values.providerId);

  const patch = (next: Partial<AddBookingValues>) => {
    setValues((v) => ({ ...v, ...next }));
    // A field's message goes once the person changes it; the next Add checks again.
    const changed = Object.keys(next).map((key) => FIELD_OF[key as keyof AddBookingValues]);
    setErrors((current) => {
      const left = { ...current };
      for (const field of changed) if (field) delete left[field];
      return left;
    });
    if ('reference' in next) setDuplicate(null);
  };
  const chooseProvider = useCallback((providerId: string) => {
    setProviderMissing(false);
    // The place belongs to the provider: a new provider starts the place again.
    setValues((v) =>
      v.providerId === providerId ? v : { ...v, providerId, location: null, areaName: '' }
    );
  }, []);

  const submit = async (): Promise<boolean> => {
    const found = validateDetails(values, manifest);
    const already = existingBooking(bookings, values.providerId, values.reference);
    setErrors(found);
    setDuplicate(already ?? null);
    if (Object.keys(found).length > 0 || already) return false;
    setSubmitError(undefined);
    try {
      const booking = await create.mutateAsync(toBookingInput(values, manifest));
      toast.success(`Added ${booking.location.name} to your bookings`);
      onClose();
      onAdded(booking);
      return true;
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code !== 'CONFLICT') {
        setSubmitError(apiError.message);
        return false;
      }
      // Added meanwhile (another window, a paid hold): say so at the reference, with a link
      // when the list already has it.
      const stored = existingBooking(bookings, values.providerId, values.reference);
      if (stored) setDuplicate(stored);
      else setErrors((current) => ({ ...current, reference: apiError.message }));
      return false;
    }
  };

  const onContinue = async (): Promise<boolean> => {
    if (step === 'details') return submit();
    if (!manifest) setProviderMissing(true);
    return Boolean(manifest);
  };

  return (
    <StepFlow
      label="Add booking steps"
      steps={STEPS}
      current={step}
      onStepChange={(id) => setStep(id as Step)}
      onContinue={onContinue}
      finalLabel="Add booking"
      finishing={create.isPending}
    >
      {step === 'provider' && (
        <>
          <ProviderPicker
            label="Provider"
            hint="Where you made the booking."
            value={values.providerId || undefined}
            onChange={chooseProvider}
            emptyMessage="No providers are installed"
          />
          {providerMissing && <Notice tone="warning">Choose a provider to continue.</Notice>}
        </>
      )}
      {step === 'details' && manifest && (
        <>
          <BookingDetailsFields
            manifest={manifest}
            values={values}
            onChange={patch}
            errors={errors}
            referenceError={
              duplicate ? <AlreadyAdded booking={duplicate} onOpen={onClose} /> : undefined
            }
          />
          {submitError && (
            <Notice tone="danger" title="The booking couldn't be added">
              {submitError}
            </Notice>
          )}
        </>
      )}
    </StepFlow>
  );
}

/**
 * "Add booking": a booking made outside WA Stay, provider first (every provider: adding by
 * hand needs no capability), then its details. Submits through `bookings.create`.
 */
export function AddBookingDialog({ open, onClose, bookings, onAdded }: AddBookingDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add booking"
      description="Keep a booking you made on a provider's site with the rest of your trips."
      size="lg"
      closeOnOverlayClick={false}
    >
      <AddBookingFlow onClose={onClose} bookings={bookings} onAdded={onAdded} />
    </Dialog>
  );
}

export default AddBookingDialog;
