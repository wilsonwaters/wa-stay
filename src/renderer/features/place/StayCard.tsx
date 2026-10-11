import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import { BellRing, CalendarClock } from 'lucide-react';
import { ExternalLink } from '../../components/ExternalLink';
import {
  Badge,
  Button,
  Card,
  DateRangeField,
  GuestsField,
  Notice,
  Skeleton,
  Spinner,
  VisuallyHidden,
  type DateRange,
  type Guests,
} from '../../components/ui';
import { buttonClassName } from '../../components/ui/Button';
import { InfoLink, MoreInformationLink } from './PlaceSections';
import type { CheckFailure, PlaceLinks } from './placeModel';

/** The longest stay the dates allow (EQ6), as on Explore. */
export const MAX_NIGHTS = 30;

export type CheckAbility =
  | { kind: 'loading' }
  | { kind: 'available' }
  /** Why the dates cannot be checked here, in a sentence. */
  | { kind: 'unavailable'; message: string; showInfoLink?: boolean };

export interface StayCardProps {
  shortName: string;
  dates: DateRange;
  guests: Guests | undefined;
  onDatesChange: (dates: DateRange) => void;
  onGuestsChange: (guests: Guests) => void;
  /** The earliest arrival: today, in the provider's time zone. */
  minDate: string;
  datesError?: string;
  ability: CheckAbility;
  onCheck: () => void;
  checking: boolean;
  /** The check has taken more than 10 s. */
  slow: boolean;
  /** The results on the page are for the dates in the card. */
  checked: boolean;
  failure: CheckFailure | null;
  onRetry: () => void;
  links: PlaceLinks;
  /** The create-flow hand-offs, when the provider offers them. */
  watchHref?: string;
  snipeHref?: string;
}

function FailureNotice({
  failure,
  shortName,
  onRetry,
}: {
  failure: CheckFailure;
  shortName: string;
  onRetry: () => void;
}) {
  if (failure === 'access-gate') {
    return (
      <Notice tone="warning">
        {shortName} has a waiting queue right now. Try again in a few minutes.
      </Notice>
    );
  }
  if (failure === 'rate-limit') {
    return <Notice tone="warning">Too many checks in a short time. Try again in a minute.</Notice>;
  }
  return (
    <Notice
      tone="danger"
      title="Couldn't check availability"
      actions={
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      }
    />
  );
}

/**
 * "Check your dates": the stay (dates and guests, kept in the page's address), Check
 * availability, and the ways on from here: book on the provider's site, watch, snipe, or read
 * more there. One coral action at a time (design-language.md, principle 2): Check until the
 * dates are checked, then Book.
 */
export function StayCard({
  shortName,
  dates,
  guests,
  onDatesChange,
  onGuestsChange,
  minDate,
  datesError,
  ability,
  onCheck,
  checking,
  slow,
  checked,
  failure,
  onRetry,
  links,
  watchHref,
  snipeHref,
}: StayCardProps) {
  const headingId = useId();
  const bookIsNext = checked || ability.kind === 'unavailable';
  const extraLinks: ReactNode[] = [];
  if (links.view) {
    extraLinks.push(
      <ExternalLink key="view" href={links.view}>
        View on {shortName}
      </ExternalLink>
    );
  }
  if (links.info) {
    extraLinks.push(<MoreInformationLink key="info" info={links.info} />);
  }
  if (links.visit) {
    extraLinks.push(
      <ExternalLink key="visit" href={links.visit}>
        Visit {shortName}
      </ExternalLink>
    );
  }

  return (
    <Card as="section" aria-labelledby={headingId} padding="lg" className="flex flex-col gap-5">
      <h2 id={headingId} className="text-lg font-semibold text-fg">
        Check your dates
      </h2>
      <div className="flex flex-col gap-4">
        <DateRangeField
          label="Dates"
          value={dates}
          onChange={onDatesChange}
          minDate={minDate}
          maxNights={MAX_NIGHTS}
          error={datesError}
        />
        <GuestsField label="Guests" value={guests} onChange={onGuestsChange} />
      </div>

      {ability.kind === 'loading' && <Skeleton className="h-10 w-full" />}
      {ability.kind === 'available' && (
        <Button
          variant={checked ? 'secondary' : 'primary'}
          fullWidth
          loading={checking}
          onClick={onCheck}
        >
          Check availability
        </Button>
      )}
      {ability.kind === 'unavailable' && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-fg-secondary">{ability.message}</p>
          {ability.showInfoLink && <InfoLink links={links} shortName={shortName} />}
        </div>
      )}

      {checking && slow && (
        <p className="flex items-center gap-2 text-sm text-fg-secondary">
          <Spinner size="sm" label={`Still checking ${shortName}`} />
          <span aria-hidden="true">Still checking {shortName}…</span>
        </p>
      )}
      {!checking && failure && (
        <FailureNotice failure={failure} shortName={shortName} onRetry={onRetry} />
      )}

      {(links.book || watchHref || snipeHref) && (
        <div className="flex flex-col gap-3">
          {links.book && (
            <ExternalLink
              href={links.book}
              variant={bookIsNext ? 'primary' : 'secondary'}
              fullWidth
            >
              Book on {shortName}
            </ExternalLink>
          )}
          {watchHref && (
            <Link
              to={watchHref}
              className={buttonClassName({ variant: 'secondary', fullWidth: true })}
            >
              <BellRing size={18} aria-hidden="true" />
              Watch for availability
            </Link>
          )}
          {snipeHref && (
            <Link
              to={snipeHref}
              className={buttonClassName({ variant: 'secondary', fullWidth: true })}
            >
              <CalendarClock size={18} aria-hidden="true" />
              {/* The name comes whole from the hidden text: "Snipe a site, coming soon". */}
              <span aria-hidden="true">Snipe a site</span>
              <span aria-hidden="true">
                <Badge tone="sun">Soon</Badge>
              </span>
              <VisuallyHidden>Snipe a site, coming soon</VisuallyHidden>
            </Link>
          )}
        </div>
      )}

      {extraLinks.length > 0 && (
        <ul role="list" className="flex flex-col gap-2 border-t border-border pt-4 text-sm">
          {extraLinks.map((link, i) => (
            <li key={i}>{link}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
