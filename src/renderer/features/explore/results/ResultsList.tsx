import { forwardRef, memo, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CalendarX,
  CircleAlert,
  Compass,
  LoaderCircle,
  MapPinned,
  SearchX,
  Store,
} from 'lucide-react';
import type { LocationSummary } from '../../../../shared/types/catalog.types';
import type { StayParams } from '../../../app/stayParams';
import { LocationCard, type CardAvailability } from '../../../components/LocationCard';
import { placesLabel } from '../../../components/locationFormat';
import { Button, EmptyState, Skeleton } from '../../../components/ui';
import { cx } from '../../../components/ui/cx';
import { useMinWidth } from '../../../components/ui/useMinWidth';
import { useIsHighlighted } from '../state/highlight';
import { cardId } from './cardId';

/** Cards rendered at first, and added by each "Show more places". */
export const PAGE_SIZE = 40;
const SKELETON_COUNT = 8;

export type ResultsState =
  | { kind: 'loading' }
  | { kind: 'syncing' }
  | { kind: 'failed'; retrying: boolean }
  | { kind: 'unavailable' }
  | { kind: 'no-providers' }
  | { kind: 'no-matches' }
  | { kind: 'empty-area' }
  /** "Available only" is on and availability is still being checked. */
  | { kind: 'checking' }
  /**
   * "Available only" is on and no place has a unit free for the dates (`range`), or, with
   * `checked` false, no provider could be asked (failed, or offline with nothing saved).
   */
  | { kind: 'none-available'; range: string; checked: boolean }
  | { kind: 'results' };

export interface ResultsListProps {
  state: ResultsState;
  /** The places to list (already narrowed to the map area when following the map). */
  items: readonly LocationSummary[];
  /** "Search as I move the map" is narrowing the list. */
  inMapArea: boolean;
  /** `split`: beside the map; `full`: the whole width (list-only, or a narrow window). */
  width: 'split' | 'full';
  selectedKey: string | null;
  /**
   * A place chosen on the map or in Where: its card is added to the page if it is further down
   * the list, then scrolled into view, and `onRevealed` is called.
   */
  revealKey?: string | null;
  onRevealed?: () => void;
  /** Changes when a new search replaces the results, so the list starts again at 40. */
  resetKey: string;
  onHighlight: (key: string | null) => void;
  onRetry: () => void;
  onClearFilters: () => void;
  onShowAll: () => void;
  /** Notices shown above the heading (offline, search error, list-only). */
  notices?: ReactNode;
  /** The stay each card's detail link carries. Keep it stable. */
  stay?: Partial<StayParams>;
  /** The history state each card's detail link carries. Keep it stable. */
  linkState?: unknown;
  /** How many cards to start with (more than 40 when coming back to a longer list). */
  initialShown?: number;
  /** Called with the number of cards on the page whenever it changes. */
  onShownChange?: (shown: number) => void;
  /** The places before "Available only" narrows them: the heading's count. */
  placeCount?: number;
  /** Said after the count: "3 available for 6–8 Nov", or "checking availability…". */
  availabilityNote?: string;
  /** Each card's availability for the dates, by location key; null without dates. */
  availability?: ReadonlyMap<string, CardAvailability> | null;
  /** "Show all places": turns "Available only" off. */
  onShowAllPlaces?: () => void;
  /** "Try different dates": opens the date picker. */
  onTryOtherDates?: () => void;
}

export { cardId };

/** A card that re-renders only when its own highlight or selection changes. */
const ResultCard = memo(function ResultCard({
  location,
  selected,
  layout,
  onHighlight,
  stay,
  linkState,
  availability,
}: {
  location: LocationSummary;
  selected: boolean;
  layout: 'stack' | 'row';
  onHighlight: (key: string | null) => void;
  stay?: Partial<StayParams>;
  linkState?: unknown;
  availability: CardAvailability | null;
}) {
  const highlighted = useIsHighlighted(location.key);
  return (
    <LocationCard
      id={cardId(location.key)}
      location={location}
      highlighted={highlighted}
      selected={selected}
      layout={layout}
      onHighlight={onHighlight}
      stay={stay}
      linkState={linkState}
      availability={availability}
    />
  );
});

function CardSkeleton({ layout }: { layout: 'stack' | 'row' }) {
  return (
    <div className={cx('flex', layout === 'row' ? 'flex-row gap-4' : 'flex-col gap-3')}>
      <Skeleton
        className={cx(
          'aspect-4/3 rounded-lg',
          layout === 'row' ? 'w-2/5 max-w-60 shrink-0' : 'w-full'
        )}
      />
      <div className="flex flex-1 flex-col gap-2 py-1">
        <Skeleton shape="text" className="h-4 w-3/4" />
        <Skeleton shape="text" className="w-1/2" />
        <Skeleton shape="text" className="w-1/3" />
      </div>
    </div>
  );
}

const Heading = forwardRef<HTMLHeadingElement, { children: ReactNode }>(function Heading(
  { children },
  ref
) {
  return (
    <h2 ref={ref} tabIndex={-1} className="text-xl font-semibold text-fg">
      {children}
    </h2>
  );
});

/**
 * Explore's results: a heading with the count, a grid of LocationCards (40 at a time, with
 * "Show more places"), and every state the list can be in: loading, the catalogue syncing or
 * failing, nothing matching, and nothing in the map area.
 */
export function ResultsList({
  state,
  items,
  inMapArea,
  width,
  selectedKey,
  revealKey = null,
  onRevealed,
  resetKey,
  onHighlight,
  onRetry,
  onClearFilters,
  onShowAll,
  notices,
  stay,
  linkState,
  initialShown,
  onShownChange,
  placeCount,
  availabilityNote,
  availability = null,
  onShowAllPlaces,
  onTryOtherDates,
}: ResultsListProps) {
  const lg = useMinWidth(1024);
  const xl = useMinWidth(1280);
  // Beside the map there is one column from 1024 to 1280 px: the photo sits beside the text
  // there. Below 1024 px the list has the whole width (the map is a separate pane).
  const layout = width === 'split' && lg && !xl ? 'row' : 'stack';
  const grid =
    width === 'split'
      ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-1 xl:grid-cols-2'
      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

  const [shown, setShown] = useState(() => Math.max(PAGE_SIZE, initialShown ?? PAGE_SIZE));
  // A new search starts again at 40 (not the first results: they may be a list come back to).
  const shownFor = useRef(resetKey);
  useEffect(() => {
    if (shownFor.current === resetKey) return;
    shownFor.current = resetKey;
    setShown(PAGE_SIZE);
  }, [resetKey]);
  const latestOnShown = useRef(onShownChange);
  latestOnShown.current = onShownChange;
  useEffect(() => latestOnShown.current?.(shown), [shown]);

  // A place selected on the map must have its card on the page.
  useEffect(() => {
    if (!selectedKey) return;
    const index = items.findIndex((item) => item.key === selectedKey);
    if (index >= shown) setShown(Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE);
  }, [selectedKey, items, shown]);

  // Bring a chosen place's card into view, once it is on the page.
  useEffect(() => {
    if (!revealKey) return;
    const index = items.findIndex((item) => item.key === revealKey);
    if (index < 0) return;
    if (index >= shown) {
      setShown(Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE);
      return;
    }
    document.getElementById(cardId(revealKey))?.scrollIntoView?.({ block: 'nearest' });
    onRevealed?.();
  }, [revealKey, items, shown, onRevealed]);

  const busy = state.kind === 'loading' || state.kind === 'syncing';
  const count = items.length;
  const places = placeCount ?? count;
  const heading = [
    inMapArea ? `${placesLabel(places)} in map area` : placesLabel(places),
    availabilityNote,
  ]
    .filter(Boolean)
    .join(' · ');
  const skeletons = (
    <ul role="list" className={cx('mt-6 grid gap-x-6 gap-y-8', grid)}>
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <li key={i}>
          <CardSkeleton layout={layout} />
        </li>
      ))}
    </ul>
  );

  let body: ReactNode;
  switch (state.kind) {
    case 'loading':
      body = (
        <>
          <Heading>Loading places</Heading>
          {skeletons}
        </>
      );
      break;
    case 'syncing':
      body = (
        <EmptyState
          size="md"
          icon={<LoaderCircle size={24} className="animate-spin" />}
          accent="sun"
          title="Getting places ready"
          description="WA Stay is loading places from your providers. This takes a few seconds the first time."
        />
      );
      break;
    case 'failed':
      body = (
        <EmptyState
          size="md"
          icon={<CircleAlert size={24} />}
          title="We couldn't load places"
          description="Check your internet connection, then try again."
          actions={
            <Button variant="secondary" loading={state.retrying} onClick={onRetry}>
              Try again
            </Button>
          }
        />
      );
      break;
    case 'unavailable':
      body = (
        <EmptyState
          size="md"
          icon={<Compass size={24} />}
          title="Places aren't available yet"
          description="This version of WA Stay can't list places yet. Watches and Site Sniper still work."
        />
      );
      break;
    case 'no-providers':
      body = (
        <EmptyState
          size="md"
          icon={<Store size={24} />}
          title="No providers with places are installed"
          description="Places appear here once a provider that lists them is added to WA Stay."
        />
      );
      break;
    case 'no-matches':
      body = (
        <EmptyState
          size="md"
          icon={<SearchX size={24} />}
          title="No places match your search"
          description="Try fewer filters or different words."
          actions={
            <Button variant="secondary" onClick={onClearFilters}>
              Clear filters
            </Button>
          }
        />
      );
      break;
    case 'empty-area':
      body = (
        <EmptyState
          size="md"
          icon={<MapPinned size={24} />}
          title="No places in this part of the map"
          description="Move the map or zoom out to see more."
          actions={
            <Button variant="secondary" onClick={onShowAll}>
              Show all of WA
            </Button>
          }
        />
      );
      break;
    case 'checking':
      body = (
        <>
          <Heading>{heading}</Heading>
          {skeletons}
        </>
      );
      break;
    case 'none-available':
      body = (
        <EmptyState
          size="md"
          icon={<CalendarX size={24} />}
          title={
            state.checked
              ? `No places have sites for ${state.range}`
              : `Availability couldn't be checked for ${state.range}`
          }
          description={
            state.checked
              ? 'Places that are full or not open for these dates are hidden.'
              : 'Show all places, or try again from the notice above.'
          }
          actions={
            <>
              <Button variant="secondary" onClick={onShowAllPlaces}>
                Show all places
              </Button>
              <Button variant="ghost" onClick={onTryOtherDates}>
                Try different dates
              </Button>
            </>
          }
        />
      );
      break;
    case 'results':
      body = (
        <>
          <Heading>{heading}</Heading>
          <ul role="list" className={cx('mt-6 grid gap-x-6 gap-y-8', grid)}>
            {items.slice(0, shown).map((item) => (
              <li key={item.key} className="scroll-mt-(--explore-sticky,8rem)">
                <ResultCard
                  location={item}
                  selected={item.key === selectedKey}
                  layout={layout}
                  onHighlight={onHighlight}
                  stay={stay}
                  linkState={linkState}
                  availability={availability?.get(item.key) ?? null}
                />
              </li>
            ))}
          </ul>
          {count > shown && (
            <div className="mt-10 flex flex-col items-center gap-3">
              <p className="text-sm text-fg-muted">
                Showing {shown} of {count}
              </p>
              <Button variant="secondary" onClick={() => setShown(shown + PAGE_SIZE)}>
                Show more places
              </Button>
            </div>
          )}
        </>
      );
      break;
  }

  return (
    <section aria-label="Results" aria-busy={busy || undefined} className="flex flex-col">
      {notices && <div className="mb-6 flex flex-col gap-3">{notices}</div>}
      {body}
    </section>
  );
}
