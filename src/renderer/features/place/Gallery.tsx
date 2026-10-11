import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react';
import { Button, Dialog, IconButton, PhotoPlaceholder, Skeleton } from '../../components/ui';
import { cx } from '../../components/ui/cx';

/** Photos shown beside the large one at 1024 px and wider. */
const MAX_TILES = 4;

/**
 * The gallery's size: always the page's full width (stated, or the aspect ratio would narrow
 * it to the height), and at most as tall as leaves the window room for the page's title above
 * and, below, the "Check your dates" card down to its main button (all of it at 1440 × 900),
 * but never under 18rem. Taller windows get more of the photo, up to its own 16:9 or 3:1.
 */
export const GALLERY_SIZE = 'w-full max-h-[max(18rem,calc(100vh-36rem))]';

/** Only https photos load (main drops other schemes; this is the renderer's own check). */
function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export const photoAlt = (name: string, index: number, count: number) =>
  `${name}, photo ${index + 1} of ${count}`;

interface PhotoProps {
  url: string;
  alt: string;
  name: string;
  kind: string;
  onFailed: (url: string) => void;
  className?: string;
  fit?: 'cover' | 'contain';
}

/**
 * One photo, hot-linked from the provider (brief O8): no referrer, a skeleton while it loads,
 * and the placeholder if it fails (the gallery then leaves it out of its count).
 */
function Photo({ url, alt, name, kind, onFailed, className, fit = 'cover' }: PhotoProps) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setState('loading');
    // A photo already in the cache can finish before React listens for it.
    const image = imageRef.current;
    if (image?.complete) setState(image.naturalWidth > 0 ? 'loaded' : 'failed');
  }, [url]);
  useEffect(() => {
    if (state === 'failed') onFailed(url);
  }, [state, url, onFailed]);

  return (
    <div className={cx('relative overflow-hidden bg-surface-subtle', className)}>
      {state !== 'failed' && (
        <img
          ref={imageRef}
          src={url}
          alt={alt}
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          className={cx(
            'h-full w-full transition-opacity duration-base ease-standard',
            fit === 'cover' ? 'object-cover' : 'object-contain',
            state === 'loaded' ? 'opacity-100' : 'opacity-0'
          )}
        />
      )}
      {state === 'loading' && <Skeleton shape="fill" className="absolute inset-0" />}
      {state === 'failed' && (
        <PhotoPlaceholder
          aria-label={`No photo available for ${name}`}
          kind={kind}
          size="hero"
          className="absolute inset-0"
        />
      )}
    </div>
  );
}

/** Where each tile beside the large photo goes, by how many there are (4 columns × 2 rows). */
const TILE_LAYOUT: Record<number, string[]> = {
  1: ['lg:col-span-2 lg:row-span-2 lg:rounded-r-2xl'],
  2: ['lg:col-span-2 lg:rounded-tr-2xl', 'lg:col-span-2 lg:rounded-br-2xl'],
  3: ['lg:col-span-2 lg:rounded-tr-2xl', '', 'lg:rounded-br-2xl'],
  4: ['', 'lg:rounded-tr-2xl', '', 'lg:rounded-br-2xl'],
};

export interface GalleryProps {
  /** The place's name, for alt text and the dialog's name. */
  name: string;
  /** The place's kind, for the placeholder's icon. */
  kind: string;
  imageUrls: readonly string[];
  className?: string;
}

/**
 * A place's photos. At 1024 px and wider, one large photo and up to 4 tiles (3:2); below, the
 * large photo alone; never taller than `GALLERY_SIZE` allows, so the stay card shows too. "Show
 * all {n} photos" (and each photo) opens them all in a full-size dialog, "Photos of {name}",
 * with ←/→, a "3 of 12" counter, Escape to close and focus back where it was. One photo is a
 * 16:9 hero; none is the placeholder. Photos that fail to load show the placeholder and drop
 * out of the count.
 */
export function Gallery({ name, kind, imageUrls, className }: GalleryProps) {
  const urls = useMemo(() => [...new Set(imageUrls)].filter(isHttps), [imageUrls]);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const photos = useMemo(() => urls.filter((url) => !failed.has(url)), [urls, failed]);
  const [openAt, setOpenAt] = useState<number | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const markFailed = useCallback(
    (url: string) =>
      setFailed((current) => (current.has(url) ? current : new Set(current).add(url))),
    []
  );

  const count = photos.length;
  const index = openAt === null || count === 0 ? null : Math.min(openAt, count - 1);
  const close = useCallback(() => setOpenAt(null), []);
  const step = useCallback(
    (by: number) =>
      setOpenAt((at) => (at === null || count === 0 ? at : (at + by + count) % count)),
    [count]
  );

  // ← and → move between photos while the dialog is open.
  useEffect(() => {
    if (index === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'ArrowRight') step(1);
      else return;
      event.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, step]);

  if (urls.length === 0) {
    return (
      // As tall as the photo grid would be, so a place without photos stays calm.
      <div
        className={cx(
          'aspect-video overflow-hidden rounded-2xl lg:aspect-3/1',
          GALLERY_SIZE,
          className
        )}
      >
        <PhotoPlaceholder aria-label={`No photo available for ${name}`} kind={kind} size="hero" />
      </div>
    );
  }

  const altFor = (url: string) => {
    const at = photos.indexOf(url);
    return at < 0 ? '' : photoAlt(name, at, count);
  };

  if (urls.length === 1) {
    return (
      <Photo
        url={urls[0]}
        alt={altFor(urls[0])}
        name={name}
        kind={kind}
        onFailed={markFailed}
        className={cx('aspect-video rounded-2xl', GALLERY_SIZE, className)}
      />
    );
  }

  const [hero, ...rest] = urls;
  const tiles = rest.slice(0, MAX_TILES);
  const tileLayout = TILE_LAYOUT[tiles.length];
  const open = (url: string) => {
    const at = photos.indexOf(url);
    setOpenAt(at < 0 ? 0 : at);
  };
  const tile = (url: string, layout: string, extra?: string) =>
    failed.has(url) ? (
      <div key={url} className={cx('overflow-hidden', layout, extra)}>
        <PhotoPlaceholder
          aria-label={`No photo available for ${name}`}
          kind={kind}
          size={url === hero ? 'hero' : 'card'}
        />
      </div>
    ) : (
      <button
        key={url}
        type="button"
        onClick={() => open(url)}
        className={cx('group relative overflow-hidden', layout, extra)}
      >
        <Photo
          url={url}
          alt={altFor(url)}
          name={name}
          kind={kind}
          onFailed={markFailed}
          className="h-full w-full transition-[filter] duration-fast ease-standard group-hover:brightness-95"
        />
      </button>
    );

  const current = index === null ? null : photos[index];

  return (
    <div className={cx('relative', className)}>
      <div className={cx('grid gap-2 lg:aspect-3/1 lg:grid-cols-4 lg:grid-rows-2', GALLERY_SIZE)}>
        {tile(
          hero,
          cx(
            'aspect-video rounded-2xl lg:col-span-2 lg:row-span-2 lg:aspect-auto lg:rounded-r-none lg:rounded-l-2xl',
            GALLERY_SIZE
          )
        )}
        {tiles.map((url, i) => tile(url, tileLayout[i], 'max-lg:hidden'))}
      </div>
      {count > 1 && (
        <Button
          variant="floating"
          size="sm"
          leadingIcon={<LayoutGrid size={16} aria-hidden="true" />}
          onClick={() => setOpenAt(0)}
          className="absolute bottom-4 right-4"
        >
          Show all {count} photos
        </Button>
      )}

      <Dialog
        open={current !== null}
        onClose={close}
        title={`Photos of ${name}`}
        size="full"
        initialFocusRef={nextRef}
      >
        {current !== null && index !== null && (
          <div className="flex h-full min-h-[50vh] flex-col items-center gap-4">
            <Photo
              key={current}
              url={current}
              alt={photoAlt(name, index, count)}
              name={name}
              kind={kind}
              onFailed={markFailed}
              fit="contain"
              className="w-full min-h-0 flex-1 rounded-lg bg-canvas"
            />
            <div className="flex items-center gap-4">
              <IconButton
                label="Previous photo"
                icon={<ChevronLeft />}
                variant="secondary"
                shape="pill"
                onClick={() => step(-1)}
              />
              <p className="min-w-20 text-center text-sm font-semibold tabular-nums text-fg">
                {index + 1} of {count}
              </p>
              <IconButton
                ref={nextRef}
                label="Next photo"
                icon={<ChevronRight />}
                variant="secondary"
                shape="pill"
                onClick={() => step(1)}
              />
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

export default Gallery;
