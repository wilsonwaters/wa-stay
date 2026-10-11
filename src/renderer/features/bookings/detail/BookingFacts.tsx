import { useId, type ReactNode } from 'react';
import type { Booking } from '../../../../shared/types/booking.types';
import type { UnitSummary } from '../../../../shared/types/catalog.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { partyLabel } from '../../../components/stay/stayFormat';
import { Card } from '../../../components/ui';
import { cx } from '../../../components/ui/cx';
import {
  formatCost,
  fullDayLabel,
  stayParamRows,
  tripNightsLabel,
  unitLabel,
} from '../shared/bookingFormat';
import { CopyReference } from './CopyReference';

export interface BookingFactsProps {
  booking: Booking;
  manifest: ProviderManifest | undefined;
  /** The place's units from the catalogue, to name an older paid hold's class. */
  units?: readonly UnitSummary[];
}

/** One group of facts: a small label over its content, the label naming the section. */
function FactGroup({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <h2 id={id} className="text-sm font-semibold text-fg-secondary">
        {title}
      </h2>
      <div className="text-base text-fg">{children}</div>
    </section>
  );
}

/** One side of the stay: "Check-in" over "Fri 30 Oct 2026", a `dt`/`dd` group of the `dl`. */
function StayDay({ label, date, className }: { label: string; date: string; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-0.5', className)}>
      <dt className="text-sm text-fg-secondary">{label}</dt>
      <dd className="text-lg font-semibold text-fg">{fullDayLabel(date)}</dd>
    </div>
  );
}

/**
 * The booking's facts, grouped as a trip reads: the stay (check-in and check-out side by side,
 * then its nights); who, which unit and what it cost, lined up in one row; the reference with
 * its copy button. Then the notes.
 */
export function BookingFacts({ booking, manifest, units }: BookingFactsProps) {
  const { stay } = booking;
  const nights = tripNightsLabel(stay);
  const unit = unitLabel(booking, manifest, units);
  const params = stayParamRows(booking.stayParams, manifest);
  const hasCost = booking.totalCost !== undefined && booking.totalCost !== null;
  const notesId = useId();

  return (
    <>
      <Card padding="none" className="divide-y divide-border">
        <FactGroup title="Stay" className="p-5 sm:p-6">
          <dl className="grid grid-cols-2 gap-4 sm:max-w-xl">
            <StayDay label="Check-in" date={stay.arrival} />
            <StayDay
              label="Check-out"
              date={stay.departure}
              className="border-l border-border pl-4"
            />
          </dl>
          {nights && <p className="mt-2 text-sm text-fg-secondary">{nights}</p>}
        </FactGroup>
        <div className="grid gap-6 p-5 sm:grid-cols-3 sm:p-6">
          <FactGroup title="Guests">{partyLabel(stay)}</FactGroup>
          {(unit || params.length > 0) && (
            <FactGroup title="Unit">
              {unit && <p className="font-medium">{unit}</p>}
              {params.map((row) => (
                <p key={row.label} className="text-sm text-fg-secondary">
                  {row.label}: <span className="text-fg">{row.value}</span>
                </p>
              ))}
            </FactGroup>
          )}
          {hasCost && (
            <FactGroup title="Cost">
              <span className="font-medium">
                {formatCost(booking.totalCost as number, booking.currency)}
              </span>
            </FactGroup>
          )}
        </div>
        <FactGroup title="Reference" className="p-5 sm:p-6">
          <CopyReference reference={booking.bookingReference} />
        </FactGroup>
      </Card>
      {booking.notes && (
        <section aria-labelledby={notesId} className="flex flex-col gap-2">
          <h2 id={notesId} className="text-xl font-semibold text-fg">
            Notes
          </h2>
          <p className="max-w-2xl whitespace-pre-line text-base text-fg-secondary">
            {booking.notes}
          </p>
        </section>
      )}
    </>
  );
}

export default BookingFacts;
