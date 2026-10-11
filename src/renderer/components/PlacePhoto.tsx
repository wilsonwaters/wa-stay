import type { LocationSummary } from '../../shared/types/catalog.types';
import { LocationPhoto } from './LocationCard';
import { Skeleton } from './ui';
import { cx } from './ui/cx';

/** What a place's photo needs from the catalogue's record of it (summary or detail). */
export type PhotoPlace = Pick<LocationSummary, 'imageUrls' | 'kind'>;

export interface PlacePhotoProps {
  /** The place's name: the photo's alt text, and the placeholder's label. */
  name: string;
  /** The catalogue's record of the place; undefined when it has none. */
  place?: PhotoPlace;
  /** The catalogue is still answering: a skeleton, rather than a placeholder that then changes. */
  loading?: boolean;
  /** Sets the size and corners; the photo fills it. */
  className?: string;
}

/**
 * The photo of a watch's, snipe's or booking's place: E1's LocationPhoto (https only, lazy, no
 * referrer, the placeholder when there is none), named by the place. The photo URL comes from
 * the catalogue (`useCatalogPlaces` for a list, `useLocationDetail` for one place); the only
 * request it makes is for the image itself.
 */
export function PlacePhoto({ name, place, loading = false, className }: PlacePhotoProps) {
  if (loading) return <Skeleton shape="fill" className={cx('shrink-0', className)} />;
  return (
    <LocationPhoto
      location={{ name, kind: place?.kind, imageUrls: place?.imageUrls ?? [] }}
      alt={name}
      className={cx('shrink-0', className)}
    />
  );
}

export default PlacePhoto;
