import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { Search, X } from 'lucide-react';
import type { BoundingBox, LocationSummary } from '../../../../shared/types/catalog.types';
import { LocationPhoto } from '../../../components/LocationCard';
import { areaLine, hasMapLocation, placesLabel } from '../../../components/locationFormat';
import {
  Button,
  IconButton,
  ProviderBadge,
  Spinner,
  Switch,
  useOverlay,
} from '../../../components/ui';
import { buttonClassName } from '../../../components/ui/Button';
import { cx } from '../../../components/ui/cx';
import { ROUTES } from '../../../app/routes';
import type { StayParams } from '../../../app/stayParams';
import { cardId } from '../results/cardId';
import { useHighlightStore } from '../state/highlight';
import { PULSE_INTERVAL_MS, PULSE_OPACITY } from './layers';
import { createMapboxController } from './mapboxController';
import type { MapCamera, MapController, MapViewState, PinAvailability } from './types';
import { readMapTokens } from './waPalette';

export interface FitRequest {
  id: number;
  bbox: BoundingBox;
  maxZoom?: number;
  /** False jumps there: the first view of a search opened from a link or Back. */
  animate?: boolean;
}

export interface FlyRequest {
  id: number;
  lng: number;
  lat: number;
  zoom?: number;
}

export interface MapViewProps {
  token: string;
  /** The places to draw: the results, before any map-area narrowing. */
  items: readonly LocationSummary[];
  /** Any catalogue place by key (a selection may be outside the results). */
  lookup: (key: string) => LocationSummary | undefined;
  /** Where to start (from the URL); WA when null. */
  initialCamera: MapCamera | null;
  selectedKey: string | null;
  follow: boolean;
  /** The map pane is on screen (below 1024 px it can be hidden behind the list). */
  shown: boolean;
  fitRequest: FitRequest | null;
  flyRequest: FlyRequest | null;
  /** When the map is ready, and every time it stops moving. */
  onView: (view: MapViewState) => void;
  /** A pin, a listed place or nothing (empty map, Escape, close) was chosen. */
  onSelect: (key: string | null) => void;
  onFollowChange: (follow: boolean) => void;
  /** "Search this area": narrow the list to `bbox`. */
  onSearchArea: (bbox: BoundingBox) => void;
  /** The map could not load, or stopped working; Explore falls back to the list. */
  onFailed: (error: Error) => void;
  /** The stay the preview's "View details" opens the place with. */
  detailStay?: Partial<StayParams>;
  /** The history state "View details" carries (where the place was opened from). */
  detailState?: unknown;
  /**
   * With dates (E3): each place's availability, which its pill shows instead of its name, and
   * the map key. Keep it memoised: the map's data is replaced when it changes.
   */
  availability?: ReadonlyMap<string, PinAvailability> | null;
  /** Availability is still loading: the pills pulse (not under reduced motion). */
  pulsing?: boolean;
}

/** True when the person asked for less motion. */
function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** States drawn hollow with an ink ring: not checked in bulk, unknown, failed or checking. */
const NOT_CHECKED = new Set(['check-dates', 'not-supported', 'unknown', 'error', 'loading']);

/**
 * The map key with dates: what each pin and pill colour means, in words beside a swatch drawn
 * as the pins are. "Not bookable online" and "Not checked" show only when such places are on
 * the map, so the key never names a mark that is not there.
 */
function MapLegend({ availability }: { availability: ReadonlyMap<string, PinAvailability> }) {
  const states = new Set([...availability.values()].map((pin) => pin.state));
  const swatch = 'inline-block h-2.5 w-2.5 shrink-0 rounded-full';
  const items: [string, string][] = [
    ['Available', 'bg-available'],
    ['None free or not open', 'bg-fg-muted'],
  ];
  if (states.has('offline-booking')) {
    items.push(['Not bookable online', 'border border-fg-muted bg-surface']);
  }
  if ([...states].some((state) => NOT_CHECKED.has(state))) {
    items.push(['Not checked', 'border border-fg bg-surface']);
  }
  return (
    <ul
      aria-label="Map key"
      className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface px-3 py-1.5 text-xs text-fg-secondary shadow-pill"
    >
      {items.map(([label, look]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cx(swatch, look)} />
          {label}
        </li>
      ))}
    </ul>
  );
}

/** The key set, as one string, so the map's data is replaced only when it really changes. */
function keySignature(items: readonly LocationSummary[]): string {
  return items.map((item) => item.key).join('\n');
}

/**
 * The Mapbox map of the results: clustered pins with name pills, hover kept in step with the
 * list, a preview for the selected place, "Search as I move the map" and "Search this area".
 * Lazy: its chunk and mapbox-gl load only when the map is shown.
 */
export default function MapView({
  token,
  items,
  lookup,
  initialCamera,
  selectedKey,
  follow,
  shown,
  fitRequest,
  flyRequest,
  onView,
  onSelect,
  onFollowChange,
  onSearchArea,
  onFailed,
  detailStay,
  detailState,
  availability = null,
  pulsing = false,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [controller, setController] = useState<MapController | null>(null);
  const highlight = useHighlightStore();

  // The latest callbacks and values, for map events.
  const latest = useRef({ onView, onSelect, onFailed, follow, lookup });
  latest.current = { onView, onSelect, onFailed, follow, lookup };

  // ---- Create once (StrictMode's second mount gets a fresh one) -------------------------
  // The map is destroyed by the last effect below, so every other effect's cleanup (the
  // pulse, subscriptions) still reaches a live map.
  const initialCameraRef = useRef(initialCamera);
  const createdRef = useRef<MapController | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const abort = new AbortController();
    createMapboxController({
      container,
      token,
      camera: initialCameraRef.current,
      tokens: readMapTokens(),
      signal: abort.signal,
      onFatalError: (error) => latest.current.onFailed(error),
    }).then(
      (instance) => {
        if (abort.signal.aborted) {
          instance.destroy();
          return;
        }
        createdRef.current = instance;
        setController(instance);
        latest.current.onView(instance.getView());
      },
      (error: Error) => {
        if (!abort.signal.aborted) latest.current.onFailed(error);
      }
    );
    return () => {
      abort.abort();
      setController(null);
    };
  }, [token]);

  // ---- Data, hover and selection ---------------------------------------------------------
  const signature = useMemo(() => keySignature(items), [items]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Once per change of places or availability, never per hover.
  useEffect(() => {
    controller?.setData(itemsRef.current, availability);
  }, [controller, signature, availability]);

  // While availability loads the pills' fill pulses, from one interval that stops when it
  // settles (or the map goes). Never under reduced motion.
  useEffect(() => {
    if (!controller || !pulsing || prefersReducedMotion()) return undefined;
    let low = true;
    controller.setPillOpacity(PULSE_OPACITY.low);
    const timer = setInterval(() => {
      low = !low;
      controller.setPillOpacity(low ? PULSE_OPACITY.low : PULSE_OPACITY.high);
    }, PULSE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      controller.setPillOpacity(PULSE_OPACITY.high);
    };
  }, [controller, pulsing]);

  useEffect(() => {
    if (!controller) return undefined;
    controller.setHovered(highlight.get());
    const unsubscribe = highlight.subscribe(() => controller.setHovered(highlight.get()));
    const unhover = controller.onFeatureHover((key) => highlight.set(key));
    return () => {
      unsubscribe();
      unhover();
    };
  }, [controller, highlight]);

  useEffect(() => {
    controller?.setSelected(selectedKey);
  }, [controller, selectedKey]);

  // ---- Camera ---------------------------------------------------------------------------
  const [areaChanged, setAreaChanged] = useState(false);
  useEffect(() => {
    if (!controller) return undefined;
    return controller.onMoveEnd((view) => {
      latest.current.onView(view);
      if (view.userInitiated && !latest.current.follow) setAreaChanged(true);
    });
  }, [controller]);
  useEffect(() => setAreaChanged(false), [follow]);

  // Fits and popups keep clear of the controls floating on top of the map.
  useLayoutEffect(() => {
    const controls = controlsRef.current;
    if (!controller || !controls) return undefined;
    const measure = () =>
      controller.setOverlayInsets({ top: controls.offsetTop + controls.offsetHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(controls);
    return () => observer.disconnect();
  }, [controller]);

  useEffect(() => {
    if (controller && fitRequest) {
      controller.fitBounds(fitRequest.bbox, {
        maxZoom: fitRequest.maxZoom,
        animate: fitRequest.animate,
      });
      setAreaChanged(false);
    }
  }, [controller, fitRequest]);

  useEffect(() => {
    if (controller && flyRequest) {
      controller.flyTo({ lng: flyRequest.lng, lat: flyRequest.lat, zoom: flyRequest.zoom });
    }
  }, [controller, flyRequest]);

  // Shown again after being hidden behind the list: fit the canvas to its box.
  useEffect(() => {
    if (controller && shown) controller.resize();
  }, [controller, shown]);

  // ---- Clicks, the preview and the list of places on one spot -----------------------------
  const [spot, setSpot] = useState<{ keys: string[]; lng: number; lat: number } | null>(null);
  useEffect(() => {
    if (!controller) return undefined;
    return controller.onFeatureClick((click) => {
      if (click.type === 'location') {
        setSpot(null);
        latest.current.onSelect(click.key);
      } else if (click.type === 'locations') {
        setSpot({ keys: click.keys, lng: click.lng, lat: click.lat });
      } else {
        setSpot(null);
        latest.current.onSelect(null);
      }
    });
  }, [controller]);

  const selected = selectedKey ? lookup(selectedKey) : undefined;
  const preview = selected && hasMapLocation(selected) ? selected : undefined;
  const popupOpen = Boolean(controller && (spot || preview));

  const popupElement = useMemo(() => document.createElement('div'), []);
  const popupRef = useRef<HTMLElement>(popupElement);
  useEffect(() => {
    if (!controller) return;
    if (spot) controller.showPopup({ lng: spot.lng, lat: spot.lat }, popupElement);
    else if (preview) {
      controller.showPopup({ lng: preview.lng, lat: preview.lat }, popupElement, {
        place: preview.key,
      });
    } else controller.hidePopup();
  }, [controller, spot, preview, popupElement]);

  /**
   * Closes the preview. If focus was in it, focus goes to the place's card, or to the map
   * when the card is not on screen (a pin cannot take focus; the map is where it was).
   */
  const closePreview = () => {
    const key = selectedKey;
    const hadFocus = popupElement.contains(document.activeElement);
    onSelect(null);
    if (!hadFocus) return;
    const card = key ? document.getElementById(cardId(key)) : null;
    card?.focus();
    if (!card || document.activeElement !== card) {
      containerRef.current?.querySelector<HTMLElement>('canvas')?.focus({ preventScroll: true });
    }
  };

  const closePopup = () => {
    if (spot) setSpot(null);
    else closePreview();
  };
  // Escape closes the preview (or the list), unless a popover above it takes Escape first.
  useOverlay({ open: popupOpen, modal: false, elementRef: popupRef, onEscape: closePopup });

  // Last of the effects: React runs cleanups in the order effects are declared, so the map is
  // removed only after every other cleanup above has run.
  useEffect(
    () => () => {
      createdRef.current?.destroy();
      createdRef.current = null;
    },
    [token]
  );

  const spotPlaces = spot
    ? spot.keys.map((key) => lookup(key)).filter((p): p is LocationSummary => Boolean(p))
    : [];

  return (
    <div className="relative h-full w-full isolate">
      {/* mapbox-gl.css makes the container `position: relative`, so it is sized, not inset. */}
      <div ref={containerRef} className="ws-map h-full w-full bg-canvas" />

      {!controller && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner label="Loading map" />
        </div>
      )}

      <div
        ref={controlsRef}
        className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-3"
      >
        <div className="flex flex-col items-start gap-2">
          <div className="pointer-events-auto rounded-full bg-surface py-2 pl-4 pr-3 shadow-pill">
            <Switch
              label="Search as I move the map"
              checked={follow}
              onChange={(event) => onFollowChange(event.target.checked)}
            />
          </div>
          {availability && <MapLegend availability={availability} />}
        </div>
        {!follow && areaChanged && controller && (
          <Button
            variant="floating"
            shape="pill"
            size="sm"
            leadingIcon={<Search size={16} aria-hidden="true" />}
            className="pointer-events-auto"
            onClick={() => {
              setAreaChanged(false);
              onSearchArea(controller.getView().bbox);
            }}
          >
            Search this area
          </Button>
        )}
        {/* The zoom buttons sit top-right, in the map. */}
        <span aria-hidden="true" className="w-10 shrink-0" />
      </div>

      {createPortal(
        spot ? (
          <div role="group" aria-label={placesLabel(spotPlaces.length)} className="w-72 p-2">
            <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1">
              <p className="text-sm font-semibold text-fg">{placesLabel(spotPlaces.length)} here</p>
              <IconButton
                label="Close list"
                icon={<X size={16} />}
                size="sm"
                onClick={() => setSpot(null)}
              />
            </div>
            <ul role="list" className="max-h-64 overflow-y-auto">
              {spotPlaces.map((place) => (
                <li key={place.key}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start rounded-md px-2 py-2 text-left hover:bg-surface-subtle"
                    onClick={() => {
                      setSpot(null);
                      onSelect(place.key);
                    }}
                  >
                    <span className="text-sm font-semibold text-fg">{place.name}</span>
                    <span className="text-xs text-fg-secondary">{areaLine(place)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : preview ? (
          <div role="group" aria-label={preview.name} className="relative w-72">
            <LocationPhoto location={preview} className="aspect-video" />
            <IconButton
              label="Close preview"
              icon={<X size={16} />}
              size="sm"
              variant="floating"
              shape="pill"
              onClick={closePreview}
              className="absolute right-2 top-2"
            />
            <div className="flex flex-col gap-1 p-3">
              <p className="text-base font-semibold text-fg">{preview.name}</p>
              {areaLine(preview) && (
                <p className="text-sm text-fg-secondary">{areaLine(preview)}</p>
              )}
              <div className="mt-2 flex items-center justify-between gap-3">
                {/* The provider's name too, not only its monogram (§12.9). */}
                <ProviderBadge providerId={preview.providerId} size="sm" />
                <Link
                  to={ROUTES.placeDetail(preview.providerId, preview.externalId, detailStay)}
                  state={detailState}
                  className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                >
                  View details
                </Link>
              </div>
            </div>
          </div>
        ) : null,
        popupElement
      )}
    </div>
  );
}
