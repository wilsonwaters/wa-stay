/**
 * The `MapController` on Mapbox GL JS. The only module that loads `mapbox-gl` (and its CSS),
 * by dynamic import, so list-only mode and every page but Explore never download it.
 *
 * Base style: `outdoors-v12`, recoloured by `applyWaPalette` (see docs/design/map.md), flat
 * (mercator, no rotation or pitch), one copy of the world, zoom 3 and closer. The Mapbox logo
 * and the compact attribution sit bottom-left, clear of the app's bottom-right tray, as Mapbox's
 * terms need them visible.
 */

import type { GeoJSONSource, Map as MapboxMap, MapMouseEvent, Marker, Popup } from 'mapbox-gl';
import type { BoundingBox, LocationSummary } from '../../../../shared/types/catalog.types';
import { nudgeIntoView, PLACE_ZOOM, pillLabel, toFeatureCollection, WA_BOUNDS } from './geo';
import {
  buildLayers,
  CLUSTER_MAX_ZOOM,
  FIT_MAX_ZOOM,
  INTERACTIVE_LAYERS,
  LAYER_IDS,
  PILL_IMAGE_ID,
  pillImage,
  SOURCE_ID,
  SOURCE_SPEC,
} from './layers';
import type {
  CreateMapController,
  MapClick,
  MapController,
  MapViewState,
  PinAvailability,
} from './types';
import { applyWaPalette } from './waPalette';

export const STYLE_URL = 'mapbox://styles/mapbox/outdoors-v12';
/** How long the first load may take before Explore gives up and shows the list. */
export const LOAD_TIMEOUT_MS = 30_000;
/** Space kept around fitted results, and below Explore's controls at the top. */
export const FIT_PADDING = 48;
const FIT_GAP = 16;
/** Space kept between a popup and the map's edges (or Explore's controls). */
export const POPUP_MARGIN = 12;
/** How long a pan to fit a popup takes. Mapbox jumps instead under reduced motion. */
const POPUP_PAN_MS = 250;

type MapboxModule = typeof import('mapbox-gl');

/**
 * A rendered feature, as far as this module reads it. (mapbox-gl types features with the
 * global `GeoJSON` namespace from @types/geojson, which this project does not install.)
 */
interface RenderedFeature {
  layer?: { id: string };
  properties?: Record<string, unknown> | null;
  geometry: { type: string; coordinates?: unknown };
}

function abortError(): Error {
  const error = new Error('The map was closed before it loaded');
  error.name = 'AbortError';
  return error;
}

/** HTTP status of a Mapbox error event, when it has one. */
function errorStatus(event: { error?: unknown }): number | undefined {
  const status = (event.error as { status?: unknown } | undefined)?.status;
  return typeof status === 'number' ? status : undefined;
}

const isAuthFailure = (status: number | undefined) => status === 401 || status === 403;

/**
 * Whether a move's `originalEvent` is the person's input, so the move is theirs.
 *
 * Mapbox passes the DOM event behind a move as its `originalEvent`: a drag or box zoom ends on
 * a mouse or touch event, a scroll zoom on its last `WheelEvent`, the keyboard on its
 * `KeyboardEvent`, a double-click and the zoom buttons on theirs, and a cluster click passes
 * its click on (`openCluster`). But Mapbox GL 3 also ends a move with the window's own event:
 * `_onWindowResize` calls `resize({ originalEvent })` for `resize`, `orientationchange` and
 * `fullscreenchange`, so maximising or resizing the window would read as a pan and narrow the
 * list to the map area (M1).
 *
 * An allowlist of input event classes (`WheelEvent` and `PointerEvent` are `MouseEvent`s) rather
 * than a blocklist of `resize`: it stays right when Mapbox passes some other non-input event
 * (it already passes three), and needs no state. Tracking gestures with flags (`dragstart`,
 * `wheel`, `keydown`…) would have to know when each one ends, including inertia and eased
 * keyboard moves, and a resize during a gesture would still pass.
 */
function isUserInput(event: unknown): boolean {
  return (
    event instanceof MouseEvent ||
    event instanceof KeyboardEvent ||
    (typeof TouchEvent === 'function' && event instanceof TouchEvent)
  );
}

/** `getView` of a map removed before it was ever asked: the first view of WA. */
const REMOVED_VIEW: MapViewState = {
  camera: {
    lng: (WA_BOUNDS[0][0] + WA_BOUNDS[1][0]) / 2,
    lat: (WA_BOUNDS[0][1] + WA_BOUNDS[1][1]) / 2,
    zoom: 4,
  },
  bbox: [WA_BOUNDS[0][0], WA_BOUNDS[0][1], WA_BOUNDS[1][0], WA_BOUNDS[1][1]],
  userInitiated: false,
};

/** The style setters `syncLayers` uses, typed loosely: the values come from `buildLayers`. */
interface LayerStyle {
  setPaintProperty(layer: string, name: string, value: unknown): unknown;
  setLayoutProperty(layer: string, name: string, value: unknown): unknown;
  setLayerZoomRange(layer: string, minzoom: number, maxzoom: number): unknown;
  setFilter(layer: string, filter: unknown): unknown;
}

/** Mapbox's widest zoom range for a layer. */
const MAX_LAYER_ZOOM = 24;

export const createMapboxController: CreateMapController = async ({
  container,
  token,
  camera,
  tokens,
  signal,
  onFatalError,
}) => {
  const [module] = await Promise.all([import('mapbox-gl'), import('mapbox-gl/dist/mapbox-gl.css')]);
  if (signal?.aborted) throw abortError();
  const mapboxgl = (module as unknown as { default?: MapboxModule }).default ?? module;

  const map: MapboxMap = new mapboxgl.Map({
    container,
    accessToken: token,
    style: STYLE_URL,
    projection: 'mercator',
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    renderWorldCopies: false,
    minZoom: 3,
    logoPosition: 'bottom-left',
    attributionControl: false,
    ...(camera
      ? { center: [camera.lng, camera.lat] as [number, number], zoom: camera.zoom }
      : { bounds: WA_BOUNDS, fitBoundsOptions: { padding: 32 } }),
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

  // ---- State --------------------------------------------------------------------------
  let items: readonly LocationSummary[] = [];
  const byKey = new Map<string, LocationSummary>();
  /** With dates: each place's availability, which its pill shows instead of its name. */
  let availability: ReadonlyMap<string, PinAvailability> | null = null;
  let pillOpacity = 1;
  let collection = toFeatureCollection([]);
  let hovered: string | null = null;
  let selected: string | null = null;
  /** The place whose preview is open. */
  let previewed: string | null = null;
  let pointerKey: string | null = null;
  let insetTop = 0;
  let destroyed = false;
  /** The view `getView` last gave, for calls after `destroy()`. */
  let lastView: MapViewState | null = null;

  const moveListeners = new Set<(view: MapViewState) => void>();
  const hoverListeners = new Set<(key: string | null) => void>();
  const clickListeners = new Set<(click: MapClick) => void>();

  const source = () => map.getSource(SOURCE_ID) as GeoJSONSource | undefined;

  const setState = (key: string | null, state: Record<string, boolean>) => {
    if (key && source()) map.setFeatureState({ source: SOURCE_ID, id: key }, state);
  };

  // The one DOM pill for the hovered or selected place: on top of everything, even when the
  // place is inside a cluster. Decorative: the card and the preview carry its name. Not shown
  // for the place whose preview is open, which already names it.
  const markerElement = document.createElement('div');
  markerElement.setAttribute('aria-hidden', 'true');
  markerElement.setAttribute('role', 'presentation');
  markerElement.setAttribute('aria-label', '');
  markerElement.className =
    'pointer-events-none whitespace-nowrap rounded-full bg-surface-inverse px-3 py-1 text-xs font-semibold text-fg-inverse shadow-pill';
  const marker: Marker = new mapboxgl.Marker({
    element: markerElement,
    anchor: 'bottom',
    offset: [0, -10],
  });
  let markerShown = false;

  const updateMarker = () => {
    const key = hovered ?? selected;
    const item = key && key !== previewed ? byKey.get(key) : undefined;
    if (!item) {
      if (markerShown) marker.remove();
      markerShown = false;
      return;
    }
    markerElement.textContent = pillLabel(item.name);
    marker.setLngLat([item.lng, item.lat]);
    if (!markerShown) marker.addTo(map);
    markerShown = true;
  };

  const popup: Popup = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
    closeOnMove: false,
    focusAfterOpen: false,
    offset: 20,
    maxWidth: 'none',
    className: 'ws-map-popup',
  });

  // ---- Style: palette, pill image, source and layers (again after any style reload) ------
  const layerOptions = () => ({ withAvailability: availability !== null, pillOpacity });

  /**
   * Brings the app's layers from the other mode in line with `layerOptions()`: only the paint
   * and layout properties whose value differs between the modes (a property only the other
   * mode sets goes back to its default), and the filter and zoom range when they differ. Feature state
   * (hover, selection, preview) is kept.
   *
   * Untouched layers stay untouched: Mapbox GL 3 fails while redrawing a symbol layer with no
   * state-dependent paint (`cluster-count`) that was restyled while places have feature state.
   */
  const syncLayers = () => {
    const options = layerOptions();
    const wanted = buildLayers(tokens, options);
    const before = buildLayers(tokens, { ...options, withAvailability: !options.withAvailability });
    const style = map as unknown as LayerStyle;
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    wanted.forEach((layer, i) => {
      if (!map.getLayer(layer.id)) return;
      const old = before[i];
      for (const group of ['paint', 'layout'] as const) {
        const next = (layer[group] ?? {}) as Record<string, unknown>;
        const previous = (old[group] ?? {}) as Record<string, unknown>;
        for (const name of new Set([...Object.keys(next), ...Object.keys(previous)])) {
          if (same(next[name], previous[name])) continue;
          if (group === 'paint') style.setPaintProperty(layer.id, name, next[name]);
          else style.setLayoutProperty(layer.id, name, next[name]);
        }
      }
      if (!same(layer.filter, old.filter)) style.setFilter(layer.id, layer.filter);
      if (layer.minzoom !== old.minzoom || layer.maxzoom !== old.maxzoom) {
        style.setLayerZoomRange(layer.id, layer.minzoom ?? 0, layer.maxzoom ?? MAX_LAYER_ZOOM);
      }
    });
  };

  const setup = () => {
    applyWaPalette(map, tokens);
    if (!map.hasImage(PILL_IMAGE_ID)) {
      const image = pillImage();
      map.addImage(
        PILL_IMAGE_ID,
        { width: image.width, height: image.height, data: image.data },
        image.options
      );
    }
    if (!source()) map.addSource(SOURCE_ID, SOURCE_SPEC);
    for (const layer of buildLayers(tokens, layerOptions())) {
      if (!map.getLayer(layer.id)) map.addLayer(layer);
    }
    source()?.setData(collection);
    setState(hovered, { hover: true });
    setState(selected, { selected: true });
    setState(previewed, { previewed: true });
  };
  map.on('style.load', setup);

  // ---- Events -------------------------------------------------------------------------
  /**
   * What is on screen: the whole canvas. Not `getBounds()`, which leaves out the camera padding
   * that `fitBounds({ padding })` keeps, so places fitted into the margin would drop out of
   * "in map area".
   */
  const visibleBbox = (): BoundingBox => {
    const canvas = map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width > 0 && height > 0) {
      const sw = map.unproject([0, height]);
      const ne = map.unproject([width, 0]);
      return [sw.lng, sw.lat, ne.lng, ne.lat];
    }
    const bounds = map.getBounds();
    return bounds
      ? [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
      : [WA_BOUNDS[0][0], WA_BOUNDS[0][1], WA_BOUNDS[1][0], WA_BOUNDS[1][1]];
  };

  const view = (userInitiated: boolean): MapViewState => {
    const centre = map.getCenter();
    const bbox = visibleBbox();
    return {
      camera: { lng: centre.lng, lat: centre.lat, zoom: map.getZoom() },
      bbox,
      userInitiated,
    };
  };

  map.on('moveend', (event: { originalEvent?: unknown }) => {
    const state = view(isUserInput(event.originalEvent));
    for (const listener of moveListeners) listener(state);
  });

  const featuresAt = (event: MapMouseEvent): RenderedFeature[] =>
    source()
      ? (map.queryRenderedFeatures(event.point, {
          layers: INTERACTIVE_LAYERS,
        }) as unknown as RenderedFeature[])
      : [];

  const keyOf = (feature: RenderedFeature): string | null => {
    const key = feature.properties?.key;
    return typeof key === 'string' ? key : null;
  };

  const emitHover = (key: string | null) => {
    if (key === pointerKey) return;
    pointerKey = key;
    for (const listener of hoverListeners) listener(key);
  };

  map.on('mousemove', (event: MapMouseEvent) => {
    const features = featuresAt(event);
    const place = features.find((f) => f.layer?.id !== LAYER_IDS.clusters);
    map.getCanvas().style.cursor = features.length ? 'pointer' : '';
    emitHover(place ? keyOf(place) : null);
  });
  map.getCanvas().addEventListener('mouseleave', () => {
    map.getCanvas().style.cursor = '';
    emitHover(null);
  });

  const emitClick = (click: MapClick) => {
    for (const listener of clickListeners) listener(click);
  };

  const openCluster = (feature: RenderedFeature, event: MapMouseEvent) => {
    const clusters = source();
    const clusterId = feature.properties?.cluster_id;
    const pointCount = Number(feature.properties?.point_count ?? 0);
    if (!clusters || typeof clusterId !== 'number' || feature.geometry.type !== 'Point') return;
    const [lng, lat] = feature.geometry.coordinates as [number, number];
    clusters.getClusterLeaves(clusterId, pointCount, 0, (error, found) => {
      const leaves = found as unknown as RenderedFeature[] | undefined;
      if (error || !leaves) return;
      const points = leaves.flatMap((leaf) =>
        leaf.geometry.type === 'Point' ? [leaf.geometry.coordinates as [number, number]] : []
      );
      const sameSpot = points.every(
        ([x, y]) => Math.abs(x - points[0][0]) < 1e-6 && Math.abs(y - points[0][1]) < 1e-6
      );
      if (sameSpot || map.getZoom() >= CLUSTER_MAX_ZOOM + 1) {
        // Zooming cannot separate them: list them instead.
        const keys = leaves
          .map((leaf) => leaf.properties?.key)
          .filter((key): key is string => typeof key === 'string');
        emitClick({ type: 'locations', keys, lng, lat });
        return;
      }
      clusters.getClusterExpansionZoom(clusterId, (zoomError, zoom) => {
        if (zoomError || typeof zoom !== 'number') return;
        // The person's click moved the map: its `originalEvent` makes the move theirs.
        map.easeTo({ center: [lng, lat], zoom }, { originalEvent: event.originalEvent });
      });
    });
  };

  map.on('click', (event: MapMouseEvent) => {
    const features = featuresAt(event);
    const cluster = features.find((f) => f.layer?.id === LAYER_IDS.clusters);
    if (cluster) {
      openCluster(cluster, event);
      return;
    }
    const keys = [...new Set(features.map(keyOf).filter((k): k is string => k !== null))];
    if (keys.length === 1) emitClick({ type: 'location', key: keys[0] });
    else if (keys.length > 1) {
      const { lng, lat } = event.lngLat;
      emitClick({ type: 'locations', keys, lng, lat });
    } else emitClick({ type: 'empty' });
  });

  // ---- Keeping a popup on screen ---------------------------------------------------------
  /**
   * Pans the map just enough for the open popup to fit inside it, clear of Explore's controls.
   * Waits for a move in progress (a fly to the place) to end first. Mapbox only chooses which
   * side of the point a popup goes; a tall preview in a short map can fit neither side.
   */
  const keepPopupInView = (attempt = 0) => {
    if (destroyed || !popup.isOpen()) return;
    if (map.isMoving()) {
      map.once('moveend', () => keepPopupInView(attempt));
      return;
    }
    const element = popup.getElement();
    if (!element) return;
    const [dx, dy] = nudgeIntoView(
      element.getBoundingClientRect(),
      map.getContainer().getBoundingClientRect(),
      {
        top: insetTop + POPUP_MARGIN,
        right: POPUP_MARGIN,
        bottom: POPUP_MARGIN,
        left: POPUP_MARGIN,
      }
    );
    // Panning can move the popup to the point's other side: check again, a couple of times.
    if ((dx !== 0 || dy !== 0) && attempt < 2) {
      map.once('moveend', () => keepPopupInView(attempt + 1));
      map.panBy([dx, dy], { duration: POPUP_PAN_MS });
    }
  };

  // ---- First load ----------------------------------------------------------------------
  await new Promise<void>((resolve, reject) => {
    let styleLoaded = false;
    const timeout = setTimeout(
      () => fail(new Error('The map took too long to load')),
      LOAD_TIMEOUT_MS
    );
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      map.off('error', onLoadError);
    };
    const fail = (error: Error) => {
      cleanup();
      map.remove();
      reject(error);
    };
    const onAbort = () => fail(abortError());
    const onLoadError = (event: { error?: unknown }) => {
      // Before the style arrives any error is fatal; after it, only a rejected token is.
      if (!styleLoaded || isAuthFailure(errorStatus(event))) {
        const cause = event.error instanceof Error ? event.error.message : 'unknown error';
        fail(new Error(`The map couldn't load: ${cause}`));
      }
    };
    map.once('style.load', () => {
      styleLoaded = true;
    });
    map.once('load', () => {
      cleanup();
      resolve();
    });
    map.on('error', onLoadError);
    signal?.addEventListener('abort', onAbort);
  });

  map.on('error', (event: { error?: unknown }) => {
    if (isAuthFailure(errorStatus(event)) && !destroyed) {
      onFatalError?.(new Error('Mapbox refused the access token'));
    }
  });

  // ---- The controller --------------------------------------------------------------------
  const live: MapController = {
    setData(next, nextAvailability = null) {
      const modeChanged = (availability === null) !== (nextAvailability === null);
      items = next;
      availability = nextAvailability;
      byKey.clear();
      for (const item of items) byKey.set(item.key, item);
      collection = toFeatureCollection(items, availability);
      if (modeChanged) syncLayers();
      source()?.setData(collection);
      updateMarker();
    },
    setPillOpacity(opacity) {
      if (opacity === pillOpacity) return;
      pillOpacity = opacity;
      if (!map.getLayer(LAYER_IDS.pill)) return;
      const pill = buildLayers(tokens, layerOptions()).find((l) => l.id === LAYER_IDS.pill);
      (map as unknown as LayerStyle).setPaintProperty(
        LAYER_IDS.pill,
        'icon-opacity',
        (pill?.paint as Record<string, unknown> | undefined)?.['icon-opacity']
      );
    },
    setHovered(key) {
      if (key === hovered) return;
      setState(hovered, { hover: false });
      hovered = key;
      setState(hovered, { hover: true });
      updateMarker();
    },
    setSelected(key) {
      if (key === selected) return;
      setState(selected, { selected: false });
      selected = key;
      setState(selected, { selected: true });
      updateMarker();
    },
    fitBounds([west, south, east, north], options = {}) {
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        {
          padding: {
            top: Math.max(FIT_PADDING, insetTop + FIT_GAP),
            right: FIT_PADDING,
            bottom: FIT_PADDING,
            left: FIT_PADDING,
          },
          maxZoom: options.maxZoom ?? FIT_MAX_ZOOM,
          ...(options.animate === false ? { animate: false } : {}),
        }
      );
    },
    flyTo({ lng, lat, zoom }) {
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), zoom ?? PLACE_ZOOM) });
    },
    onMoveEnd(listener) {
      moveListeners.add(listener);
      return () => moveListeners.delete(listener);
    },
    onFeatureHover(listener) {
      hoverListeners.add(listener);
      return () => hoverListeners.delete(listener);
    },
    onFeatureClick(listener) {
      clickListeners.add(listener);
      return () => clickListeners.delete(listener);
    },
    showPopup({ lng, lat }, content, options = {}) {
      const place = options.place ?? null;
      if (place !== previewed) {
        setState(previewed, { previewed: false });
        previewed = place;
        setState(previewed, { previewed: true });
      }
      if (popup.getElement()?.contains(content) !== true) popup.setDOMContent(content);
      popup.setLngLat([lng, lat]);
      if (!popup.isOpen()) popup.addTo(map);
      updateMarker();
      keepPopupInView();
    },
    hidePopup() {
      popup.remove();
      setState(previewed, { previewed: false });
      previewed = null;
      updateMarker();
    },
    setOverlayInsets({ top }) {
      insetTop = Math.max(0, top);
    },
    getView: () => (lastView = view(false)),
    resize() {
      map.resize();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      moveListeners.clear();
      hoverListeners.clear();
      clickListeners.clear();
      popup.remove();
      marker.remove();
      map.remove();
    },
  };

  /**
   * After `destroy()` the map is gone, and Mapbox throws on any call to a removed map. React
   * cleanups and late events can still reach the controller, so every call is then a no-op:
   * a subscription returns a no-op unsubscribe, and `getView` the last view it gave.
   */
  const ifAlive =
    <A extends unknown[], R>(call: (...args: A) => R, removed: (...args: A) => R) =>
    (...args: A): R =>
      destroyed ? removed(...args) : call(...args);
  const nothing = () => undefined;
  const noUnsubscribe = () => () => undefined;
  const controller: MapController = {
    setData: ifAlive(live.setData, nothing),
    setPillOpacity: ifAlive(live.setPillOpacity, nothing),
    setHovered: ifAlive(live.setHovered, nothing),
    setSelected: ifAlive(live.setSelected, nothing),
    fitBounds: ifAlive(live.fitBounds, nothing),
    flyTo: ifAlive(live.flyTo, nothing),
    onMoveEnd: ifAlive(live.onMoveEnd, noUnsubscribe),
    onFeatureHover: ifAlive(live.onFeatureHover, noUnsubscribe),
    onFeatureClick: ifAlive(live.onFeatureClick, noUnsubscribe),
    showPopup: ifAlive(live.showPopup, nothing),
    hidePopup: ifAlive(live.hidePopup, nothing),
    setOverlayInsets: ifAlive(live.setOverlayInsets, nothing),
    getView: ifAlive(live.getView, () => lastView ?? REMOVED_VIEW),
    resize: ifAlive(live.resize, nothing),
    destroy: live.destroy,
  };
  return controller;
};

export default createMapboxController;
