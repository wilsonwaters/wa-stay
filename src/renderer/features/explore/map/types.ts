import type { BoundingBox, LocationSummary } from '../../../../shared/types/catalog.types';
import type { MapCamera } from '../state/exploreParams';

export type { MapCamera };

/** Where the map is looking, reported when it stops moving. */
export interface MapViewState {
  camera: MapCamera;
  /** `[west, south, east, north]` of what is visible. */
  bbox: BoundingBox;
  /**
   * The person moved the map (drag, wheel, keys, the zoom buttons, a click on a cluster), rather
   * than code (the first view, a fit to results, a fly to a place, a pan to fit a popup) or the
   * window (a resize).
   */
  userInitiated: boolean;
}

export type MapClick =
  /** A location's dot or pill. */
  | { type: 'location'; key: string }
  /**
   * Several places that zooming cannot separate (a cluster at its last zoom, or places on the
   * same spot): show them as a list.
   */
  | { type: 'locations'; keys: string[]; lng: number; lat: number }
  /** Empty map. */
  | { type: 'empty' };

/** The colours the map is drawn with, as CSS colours read from the design tokens. */
export interface MapTokens {
  /** ink-900: pins, clusters, hovered pills, text on pills. */
  ink: string;
  /** ink-700: place names on the base map. */
  ink700: string;
  /** sand-0: pin rings, cluster counts, pills, label halos, roads at street zooms. */
  white: string;
  /** sand-50: land. */
  sand50: string;
  /** sand-100 (`surface-subtle`): full and not-open pills and pins. */
  sand100: string;
  /** sand-200: roads and road casings. */
  sand200: string;
  /** sand-500: casings of unsealed tracks, the state border. */
  sand500: string;
  /** sand-600 (`fg-muted`): text on full and not-open pills. */
  sand600: string;
  /** ocean-100: water. */
  ocean100: string;
  /** ocean-200: rivers and creeks. */
  ocean200: string;
  /** eucalypt-50: national parks and parks. */
  eucalypt50: string;
  /** eucalypt-600 (`available`): national park edges, faint; available pills, pins and clusters. */
  eucalypt600: string;
}

/** A place's availability on the map (E3): its state, and the text its pill shows. */
export interface PinAvailability {
  state: string;
  pill: string;
}

/**
 * Everything Explore asks of the map. `mapboxController.ts` implements it with Mapbox GL;
 * tests use a fake. Data and highlight calls are cheap to repeat.
 */
export interface MapController {
  /**
   * Replaces the places shown. With `availability` (dates are set) every pill shows its
   * place's availability instead of its name, at every zoom, coloured by state; a place
   * missing from it reads "unknown". Without it the pills show names from zoom 8.
   */
  setData(
    items: readonly LocationSummary[],
    availability?: ReadonlyMap<string, PinAvailability> | null
  ): void;
  /** The pills' fill opacity, for the loading pulse (1 when nothing loads). */
  setPillOpacity(opacity: number): void;
  setHovered(key: string | null): void;
  setSelected(key: string | null): void;
  /** Frames `bbox`; `animate: false` jumps (the first view of a search opened from a link). */
  fitBounds(bbox: BoundingBox, options?: { maxZoom?: number; animate?: boolean }): void;
  flyTo(target: { lng: number; lat: number; zoom?: number }): void;
  /** Subscribes to the end of every move; returns an unsubscribe. */
  onMoveEnd(listener: (view: MapViewState) => void): () => void;
  /** The location under the pointer, or null when it leaves. */
  onFeatureHover(listener: (key: string | null) => void): () => void;
  onFeatureClick(listener: (click: MapClick) => void): () => void;
  /**
   * Shows `content` in a popup at a point (the preview, or a list of places), panning the map
   * if it would not fit. `place` is the location it previews: its name pill is not shown while
   * the popup is open, as the popup carries the name.
   */
  showPopup(
    at: { lng: number; lat: number },
    content: HTMLElement,
    options?: { place?: string }
  ): void;
  hidePopup(): void;
  /**
   * How much of the map's top edge Explore's own controls cover ("Search as I move the map"),
   * so fits and popups keep clear of them.
   */
  setOverlayInsets(insets: { top: number }): void;
  getView(): MapViewState;
  /** Fits the map to its container again, after the container was hidden or resized. */
  resize(): void;
  destroy(): void;
}

export interface MapControllerOptions {
  container: HTMLElement;
  /** A public `pk.` token. */
  token: string;
  /** Where to start; WA when null. */
  camera: MapCamera | null;
  tokens: MapTokens;
  /** Aborting before the map is ready removes it and rejects. */
  signal?: AbortSignal;
  /** The map stopped working after it loaded (the token was rejected). */
  onFatalError?: (error: Error) => void;
}

export type CreateMapController = (options: MapControllerOptions) => Promise<MapController>;
