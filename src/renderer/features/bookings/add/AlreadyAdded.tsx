import { Link } from 'react-router';
import type { Booking } from '../../../../shared/types/booking.types';
import { ROUTES } from '../../../app/routes';

export interface AlreadyAddedProps {
  booking: Pick<Booking, 'id' | 'location'>;
  /** Closes the dialog as the link opens the booking. */
  onOpen: () => void;
}

/** A reference field's error when that booking is already here, with a link to it. */
export function AlreadyAdded({ booking, onOpen }: AlreadyAddedProps) {
  return (
    <>
      Already in your bookings.{' '}
      <Link
        to={ROUTES.bookingDetail(booking.id)}
        onClick={onOpen}
        className="font-semibold underline underline-offset-2"
      >
        Open {booking.location.name}
      </Link>
    </>
  );
}

export default AlreadyAdded;
