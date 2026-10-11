import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useHref, useLocation, useNavigate, useParams } from 'react-router';
import { CircleAlert, MapPinOff } from 'lucide-react';
import type { UnitSummary } from '../../../shared/types/catalog.types';
import type { StayQuery } from '../../../shared/types/provider.types';
import { todayIn } from '../../../shared/utils/calendar-date';
import {
  toApiError,
  useLocationCheck,
  useLocationDetail,
  useLocationDetailUpdates,
  useProviders,
} from '../../api';
import { buildPath, PATTERNS, placeLinkState, ROUTES } from '../../app/routes';
import { stayParamsQuery, type StayParams } from '../../app/stayParams';
import { areaLine, kindLabel, unitNoun } from '../../components/locationFormat';
import {
  BackLink,
  Badge,
  Button,
  EmptyState,
  Notice,
  ProviderBadge,
  Skeleton,
  useAnnounce,
  VisuallyHidden,
  type DateRange,
  type Guests,
} from '../../components/ui';
import { buttonClassName } from '../../components/ui/Button';
import { AvailabilitySection } from './AvailabilitySection';
import { Gallery, GALLERY_SIZE } from './Gallery';
import {
  AboutSection,
  BookingRulesSection,
  FacilitiesSection,
  SitesSection,
} from './PlaceSections';
import {
  checkFailure,
  handoffPrefill,
  placeKey,
  resolvePlaceLinks,
  sameStay,
  stayQueryOf,
} from './placeModel';
import { MAX_NIGHTS, StayCard, type CheckAbility } from './StayCard';
import { usePlaceStay } from './usePlaceStay';

/** After this long, a check says it is still going (EQ7: a busy DBCA queue can delay it). */
export const SLOW_CHECK_MS = 10_000;
/** The time zone dates fall back to before the provider's manifest has loaded. */
const FALLBACK_TIME_ZONE = 'Australia/Perth';
/** Answers that mean there is no such place to show, however often it is asked. */
const NOT_AVAILABLE_CODES = new Set(['NOT_FOUND', 'UNKNOWN_PROVIDER', 'VALIDATION']);
const NO_UNITS: readonly UnitSummary[] = [];

const PAGE = 'mx-auto w-full max-w-[1120px] px-6 pb-24 pt-6 lg:px-8';

/**
 * The way back to Explore. Opened from Explore, it goes one step back, so Explore comes back as
 * it was left (search, filters, map, selection, scroll). Otherwise (a deep link, a reload) it
 * opens Explore with the stay from this page.
 */
function useBackToExplore(stay: StayParams) {
  const location = useLocation();
  const navigate = useNavigate();
  const fromExplore = placeLinkState(location.state);
  const saved = (location.state as { search?: unknown } | null)?.search;
  const search =
    typeof saved === 'string'
      ? saved
      : buildPath(PATTERNS.explore, {}, stayParamsQuery(stay)).slice(1);
  const to = { pathname: ROUTES.explore(), search };
  const href = useHref(to);

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // A plain click only, as a router Link does.
    if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (fromExplore) navigate(-1);
    else navigate(to);
  };
  return { href, onClick };
}

/** "← Explore" at the top of the page, as `PageHeader`'s back link on every other page. */
function ExploreBackLink({ stay }: { stay: StayParams }) {
  const back = useBackToExplore(stay);
  return (
    <BackLink href={back.href} onClick={back.onClick}>
      Explore
    </BackLink>
  );
}

/** "Back to Explore" as a button, where the page could not be shown. */
function BackToExplore({ stay, className }: { stay: StayParams; className?: string }) {
  const back = useBackToExplore(stay);
  return (
    <a href={back.href} onClick={back.onClick} className={className}>
      Back to Explore
    </a>
  );
}

/** The page when there is no such place: an unknown provider, or one the catalogue lacks. */
function PlaceUnavailable({ stay }: { stay: StayParams }) {
  return (
    <div className={PAGE}>
      <EmptyState
        headingLevel={1}
        icon={<MapPinOff size={24} />}
        title="This place isn't available"
        description="The provider may no longer list it, or the link is out of date."
        actions={
          <BackToExplore stay={stay} className={buttonClassName({ variant: 'secondary' })} />
        }
      />
    </div>
  );
}

/** The page when the place could not be loaded (not a missing place: try again). */
function PlaceLoadFailed({
  stay,
  message,
  onRetry,
  retrying,
}: {
  stay: StayParams;
  message: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div className={PAGE}>
      <EmptyState
        headingLevel={1}
        icon={<CircleAlert size={24} />}
        title="We couldn't load this place"
        description={message}
        actions={
          <>
            <Button variant="secondary" loading={retrying} onClick={onRetry}>
              Try again
            </Button>
            <BackToExplore stay={stay} className={buttonClassName({ variant: 'ghost' })} />
          </>
        }
      />
    </div>
  );
}

/** Stand-ins for the main column while the place's detail loads. */
function DetailSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <Skeleton className="h-6 w-32" />
      <Skeleton shape="text" className="w-full" />
      <Skeleton shape="text" className="w-11/12" />
      <Skeleton shape="text" className="w-2/3" />
    </div>
  );
}

/**
 * A place's detail page (`/places/:providerId/:externalId`, E2): photos, the description,
 * facilities, sites and booking rules, with a side card to check dates night by night and go
 * on to the provider's site, a watch or a snipe. Its stay lives in its own address.
 */
export default function PlaceDetailPage() {
  const params = useParams();
  const providerId = params.providerId ?? '';
  // React Router has already decoded the segment (`%2F` included): this is the external id.
  const externalId = params.externalId ?? '';
  const key = placeKey(providerId, externalId);
  const announce = useAnnounce();

  const providers = useProviders();
  const manifest = providers.data?.find((provider) => provider.id === providerId);
  const unknownProvider = Boolean(providers.data) && !manifest;
  // Ask for the detail once the provider is known to exist (or the list could not be read).
  const detailQuery = useLocationDetail(key, {
    enabled: Boolean(manifest) || providers.isError,
  });
  useLocationDetailUpdates(key);
  const detail = detailQuery.data;
  const loaded = Boolean(detail) && !detailQuery.isPlaceholderData;
  const shortName = manifest?.shortName ?? providerId;

  // Stays from the address keep to the provider's rules: from today in its time zone, and
  // up to MAX_NIGHTS (no provider declares a limit of its own yet).
  const minDate = todayIn(manifest?.timezone ?? FALLBACK_TIME_ZONE);
  const { stay, setStay } = usePlaceStay({ minDate, maxNights: MAX_NIGHTS });
  const currentStay = useMemo(() => stayQueryOf(stay), [stay]);

  // ---- Check availability ---------------------------------------------------------------
  // A provider may leave the units out altogether; that reads as none.
  const units = loaded && Array.isArray(detail?.units) ? detail.units : NO_UNITS;
  const canCheck = Boolean(manifest?.capabilities.availability) && units.length > 0;
  // The grid's units joined to the place's by unit id, for their limits and descriptions.
  const unitDetails = useMemo(() => new Map(units.map((unit) => [unit.unitId, unit])), [units]);
  const [requested, setRequested] = useState<StayQuery | null>(null);
  const [datesError, setDatesError] = useState<string>();
  const check = useLocationCheck(canCheck ? key : null, requested);
  const current = sameStay(requested, currentStay);
  const checked = current && Boolean(check.data);
  const failure =
    current && check.isError && !check.isFetching
      ? checkFailure(toApiError(check.error), manifest)
      : null;

  const summaryRef = useRef<HTMLParagraphElement>(null);
  /** The person pressed Check: focus and announce the result once it is on screen. */
  const awaiting = useRef(false);
  const onCheck = () => {
    if (!currentStay) {
      setDatesError('Choose your check-in and check-out dates');
      return;
    }
    setDatesError(undefined);
    awaiting.current = true;
    if (sameStay(requested, currentStay)) void check.refetch();
    else setRequested(currentStay);
  };

  useEffect(() => {
    if (!awaiting.current || check.isFetching) return;
    if (check.isError) {
      awaiting.current = false;
      const kind = checkFailure(toApiError(check.error), manifest);
      if (kind === 'access-gate') {
        announce(`${shortName} has a waiting queue right now. Try again in a few minutes.`);
      } else if (kind === 'rate-limit') {
        announce('Too many checks in a short time. Try again in a minute.');
      }
      // Anything else shows an alert, which announces itself.
      return;
    }
    if (check.data && summaryRef.current) {
      awaiting.current = false;
      summaryRef.current.focus();
      announce(summaryRef.current.textContent?.trim() ?? '');
    }
  }, [check.isFetching, check.isError, check.error, check.data, manifest, shortName, announce]);

  // Opened before anything about the place was known, the page said "Loading place"; say its
  // name once the detail arrives (with a cached summary the name was there from the start).
  const nameAnnounced = useRef(Boolean(detail));
  useEffect(() => {
    if (nameAnnounced.current || !detail) return;
    nameAnnounced.current = true;
    announce(detail.name);
  }, [detail, announce]);

  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!check.isFetching) {
      setSlow(false);
      return undefined;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_CHECK_MS);
    return () => clearTimeout(timer);
  }, [check.isFetching]);

  // ---- Which page to show -----------------------------------------------------------------
  const detailError = detailQuery.isError ? toApiError(detailQuery.error) : null;
  if (!key || unknownProvider || (detailError && NOT_AVAILABLE_CODES.has(detailError.code ?? ''))) {
    return <PlaceUnavailable stay={stay} />;
  }
  if (detailError && !detail) {
    return (
      <PlaceLoadFailed
        stay={stay}
        message={detailError.message}
        retrying={detailQuery.isFetching}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }

  const noun = unitNoun(detail?.kind ?? 'other');
  const links = detail
    ? resolvePlaceLinks(detail, manifest?.website, checked ? check.data?.bookingUrl : undefined)
    : {};
  const ability: CheckAbility =
    !loaded || !detail || (!manifest && providers.isPending)
      ? { kind: 'loading' }
      : !manifest?.capabilities.availability
        ? {
            kind: 'unavailable',
            message: `${shortName} doesn't share availability with WA Stay. Check dates on their website.`,
          }
        : units.length === 0
          ? {
              kind: 'unavailable',
              message: detail.stale
                ? `${shortName} couldn't be reached, so dates can't be checked right now.`
                : `${shortName} doesn't list ${noun.many} for ${detail.name}, so dates can't be checked in WA Stay.`,
              showInfoLink: true,
            }
          : { kind: 'available' };

  const dates: DateRange = {
    arrival: stay.arrival ?? undefined,
    departure: stay.departure ?? undefined,
  };
  const guests: Guests | undefined =
    stay.adults !== null
      ? { adults: stay.adults, children: stay.children ?? 0, infants: stay.infants ?? 0 }
      : undefined;
  const onDatesChange = (range: DateRange) => {
    if (range.arrival && range.departure) setDatesError(undefined);
    setStay({ arrival: range.arrival ?? null, departure: range.departure ?? null });
  };
  const onGuestsChange = (next: Guests) =>
    setStay({ adults: next.adults, children: next.children, infants: next.infants });

  const prefill = handoffPrefill(providerId, externalId, stay);
  const area = detail ? areaLine(detail) : '';
  const online = detail?.bookingMode === 'online';

  return (
    <div className={PAGE}>
      <ExploreBackLink stay={stay} />

      <div className="mt-3 flex flex-col gap-3">
        <h1 className="font-display text-display-md font-medium text-fg">
          {detail ? (
            detail.name
          ) : (
            <>
              <Skeleton className="h-10 w-80 max-w-full" />
              <VisuallyHidden>Loading place</VisuallyHidden>
            </>
          )}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-fg-secondary">
          <ProviderBadge providerId={providerId} />
          {detail && (
            <>
              <span aria-hidden="true">·</span>
              <span>{kindLabel(detail.kind)}</span>
              {area && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{area}</span>
                </>
              )}
              <Badge tone={online ? 'brand' : 'neutral'}>
                {online ? 'Book online' : 'Info only'}
              </Badge>
            </>
          )}
        </div>
      </div>

      {detail?.stale && (
        <Notice tone="info" className="mt-6">
          {shortName} couldn&apos;t be reached just now, so some details may be missing or out of
          date.
        </Notice>
      )}

      {detail ? (
        <Gallery
          name={detail.name}
          kind={detail.kind}
          imageUrls={detail.imageUrls}
          className="mt-6"
        />
      ) : (
        <Skeleton className={`mt-6 aspect-video rounded-2xl lg:aspect-3/1 ${GALLERY_SIZE}`} />
      )}

      <div
        className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-16"
        aria-busy={!loaded || undefined}
      >
        {/* First in the page's order, so one column (below 1024 px) reads card, results, then
            the place; from 1024 px it is the sticky right-hand column. */}
        <div className="lg:sticky lg:top-22 lg:col-start-2 lg:row-start-1">
          <StayCard
            shortName={shortName}
            dates={dates}
            guests={guests}
            onDatesChange={onDatesChange}
            onGuestsChange={onGuestsChange}
            minDate={minDate}
            datesError={datesError}
            ability={ability}
            onCheck={onCheck}
            checking={check.isFetching}
            slow={slow}
            checked={checked}
            failure={failure}
            onRetry={() => void check.refetch()}
            links={links}
            watchHref={manifest?.capabilities.watches ? ROUTES.watchNew(prefill) : undefined}
            snipeHref={manifest?.capabilities.snipes ? ROUTES.snipeNew(prefill) : undefined}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-12 lg:col-start-1 lg:row-start-1">
          {requested && check.data && (
            <AvailabilitySection
              availability={check.data}
              arrival={requested.arrival}
              departure={requested.departure}
              current={current}
              unitNoun={noun}
              currency={manifest?.currency}
              source={shortName}
              timeZone={manifest?.timezone ?? FALLBACK_TIME_ZONE}
              summaryRef={summaryRef}
              unitDetails={unitDetails}
            />
          )}
          {loaded && detail ? (
            <AboutSection detail={detail} shortName={shortName} links={links} />
          ) : (
            <DetailSkeleton />
          )}
          {detail && <FacilitiesSection amenities={detail.amenities} />}
          {loaded && detail && (
            <SitesSection units={units} unitCount={detail.unitCount} kind={detail.kind} />
          )}
          {loaded && detail && <BookingRulesSection releaseInfo={detail.releaseInfo} />}
        </div>
      </div>
    </div>
  );
}
