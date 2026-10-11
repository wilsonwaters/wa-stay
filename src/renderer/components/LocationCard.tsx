import { memo, useEffect, useId, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { MapPinOff } from 'lucide-react';
import type { LocationSummary } from '../../shared/types/catalog.types';
import { ROUTES } from '../app/routes';
import type { StayParams } from '../app/stayParams';
import { amenityIcon } from './amenityIcons';
import { areaLine, hasMapLocation, kindLabel, unitCountLabel } from './locationFormat';
import {
  Badge,
  PhotoPlaceholder,
  ProviderBadge,
  Skeleton,
  VisuallyHidden,
  type BadgeTone,
} from './ui';
import { cx } from './ui/cx';

export interface LocationPhotoProps {
  /** `kind` picks the placeholder's icon; a record that keeps no kind gets a map pin. */
  location: Pick<LocationSummary, 'name' | 'imageUrls'> & Partial<Pick<LocationSummary, 'kind'>>;
  /**
   * The photo's text alternative. Default `''` (decorative), for a photo beside the place's
   * own name; pass the name where the photo stands for the place, as a watch's does.
   */
  alt?: string;
  className?: string;
}

/**
 * The photo URL to load: only `https:`. Main already drops other schemes from provider data;
 * this is the renderer's own check, so a stray `http:`, `file:` or `data:` URL never loads.
 */
export function photoUrl(urls: readonly string[]): string | undefined {
  const first = urls[0];
  if (!first) return undefined;
  try {
    return new URL(first).protocol === 'https:' ? first : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A location's first photo, hot-linked from the provider (brief O8): lazy, decoded off the
 * main thread, sent with no referrer, and only over https. A skeleton shows while it loads; a
 * missing or broken photo shows the PhotoPlaceholder, named "No photo available for {name}".
 * The parent sets the size; the photo fills it.
 */
export function LocationPhoto({ location, alt = '', className }: LocationPhotoProps) {
  const src = photoUrl(location.imageUrls);
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>(src ? 'loading' : 'failed');
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setState(src ? 'loading' : 'failed');
    // A photo already in the cache can finish before React listens for it.
    const image = imageRef.current;
    if (src && image?.complete) setState(image.naturalWidth > 0 ? 'loaded' : 'failed');
  }, [src]);

  return (
    <div className={cx('relative overflow-hidden bg-surface-subtle', className)}>
      {state !== 'failed' && src && (
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          className={cx(
            'h-full w-full object-cover transition-opacity duration-base ease-standard',
            state === 'loaded' ? 'opacity-100' : 'opacity-0'
          )}
        />
      )}
      {state === 'loading' && <Skeleton shape="fill" className="absolute inset-0" />}
      {state === 'failed' && (
        <PhotoPlaceholder
          aria-label={`No photo available for ${location.name}`}
          kind={location.kind}
          className="absolute inset-0"
        />
      )}
    </div>
  );
}

const MAX_AMENITY_ICONS = 3;

function Amenities({ amenities }: { amenities: string[] }) {
  if (amenities.length === 0) return null;
  const shown = amenities.slice(0, MAX_AMENITY_ICONS);
  const more = amenities.length - shown.length;
  return (
    <span className="flex items-center gap-2 text-fg-secondary">
      {shown.map((amenity) => {
        const Icon = amenityIcon(amenity);
        return (
          <span key={amenity} title={amenity} className="inline-flex">
            <Icon size={16} aria-hidden="true" />
            <VisuallyHidden>{amenity}</VisuallyHidden>
          </span>
        );
      })}
      {more > 0 && (
        <span className="text-xs font-semibold tabular-nums">
          <span aria-hidden="true">+{more}</span>
          <VisuallyHidden>{`${more} more ${more === 1 ? 'facility' : 'facilities'}`}</VisuallyHidden>
        </span>
      )}
    </span>
  );
}

/**
 * A place's availability for the stay being searched (E3): a badge with its words and tone, or
 * a skeleton line while it is checked.
 */
export type CardAvailability =
  | { status: 'loading' }
  | {
      status: 'ready';
      text: string;
      tone: Extract<BadgeTone, 'available' | 'neutral' | 'danger'>;
      /** The text gives the unit total ("8 of 24 sites available"): the unit count is left out. */
      statesTotal?: boolean;
    };

export interface LocationCardProps {
  location: LocationSummary;
  /** Its pin is hovered, or it is hovered or focused itself. */
  highlighted?: boolean;
  /** The selected place on the map. */
  selected?: boolean;
  /** `stack`: photo above the text (grids); `row`: photo beside it (a single column). */
  layout?: 'stack' | 'row';
  /** Called with the key on hover or focus, and null when it ends. Keep it stable. */
  onHighlight?: (key: string | null) => void;
  /** The DOM id, so a map pin can scroll its card into view. */
  id?: string;
  /** The stay to open the detail page with (Explore's dates and guests). Keep it stable. */
  stay?: Partial<StayParams>;
  /** History state for the detail link, e.g. where it was opened from. Keep it stable. */
  linkState?: unknown;
  /**
   * Its availability for the stay being searched, shown under the area line. Leave it out
   * when no dates are chosen: nothing is shown then.
   */
  availability?: CardAvailability | null;
  /** Extra content under the details. */
  children?: ReactNode;
}

/**
 * A place to stay in a list: one link to its detail page, named by its name, with the photo,
 * area, provider, kind, facilities, how it is booked and how many units it has. The rest of the
 * card is read as the link's description.
 */
export const LocationCard = memo(function LocationCard({
  location,
  highlighted = false,
  selected = false,
  layout = 'stack',
  onHighlight,
  id,
  stay,
  linkState,
  availability,
  children,
}: LocationCardProps) {
  const generated = useId();
  const nameId = `${generated}-name`;
  const detailsId = `${generated}-details`;
  const area = areaLine(location);
  const row = layout === 'row';

  const leave = (event: FocusEvent<HTMLAnchorElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHighlight?.(null);
  };

  return (
    <Link
      id={id}
      to={ROUTES.placeDetail(location.providerId, location.externalId, stay)}
      state={linkState}
      aria-labelledby={nameId}
      aria-describedby={detailsId}
      aria-current={selected ? 'true' : undefined}
      data-highlighted={highlighted || undefined}
      onMouseEnter={() => onHighlight?.(location.key)}
      onMouseLeave={() => onHighlight?.(null)}
      onFocus={() => onHighlight?.(location.key)}
      onBlur={leave}
      className={cx(
        'group -m-2 flex rounded-xl p-2 text-fg transition-[background-color,box-shadow] duration-fast ease-standard',
        row ? 'flex-row gap-4' : 'flex-col gap-3',
        // Hovered (here or on its pin) or selected: lifted onto a white surface. Selected adds a
        // thin brand outline, the design system's selected colour (not the focus ring's 2 px).
        highlighted || selected ? 'bg-surface shadow-pop' : 'hover:bg-surface hover:shadow-card',
        selected && 'ring-1 ring-brand'
      )}
    >
      <LocationPhoto
        location={location}
        className={cx('aspect-4/3 shrink-0 rounded-lg', row ? 'w-2/5 max-w-60' : 'w-full')}
      />
      <div className={cx('flex min-w-0 flex-1 flex-col gap-1', row && 'py-1')}>
        <p id={nameId} className="line-clamp-2 text-base font-semibold text-fg">
          {location.name}
        </p>
        <div id={detailsId} className="flex flex-col gap-1.5">
          {area && <p className="line-clamp-2 text-sm text-fg-secondary">{area}</p>}
          {availability?.status === 'ready' && (
            <p>
              <Badge tone={availability.tone}>{availability.text}</Badge>
            </p>
          )}
          {availability?.status === 'loading' && (
            <p className="flex h-5 items-center">
              <Skeleton shape="text" className="w-32" />
              <VisuallyHidden>Checking availability</VisuallyHidden>
            </p>
          )}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-secondary">
            <ProviderBadge providerId={location.providerId} variant="compact" size="sm" />
            <span>{kindLabel(location.kind)}</span>
            {location.unitCount !== undefined &&
              location.unitCount > 0 &&
              !(availability?.status === 'ready' && availability.statesTotal) && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {unitCountLabel(location.kind, location.unitCount)}
                  </span>
                </>
              )}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Badge tone={location.bookingMode === 'online' ? 'brand' : 'neutral'}>
              {location.bookingMode === 'online' ? 'Book online' : 'Info only'}
            </Badge>
            <Amenities amenities={location.amenities} />
          </div>
          {!hasMapLocation(location) && (
            <p className="flex items-center gap-1.5 text-xs text-fg-muted">
              <MapPinOff size={14} aria-hidden="true" />
              No map location
            </p>
          )}
          {children}
        </div>
      </div>
    </Link>
  );
});

export default LocationCard;
