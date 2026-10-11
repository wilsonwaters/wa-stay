/**
 * A `MapController` for tests: records what Explore asks of the map and lets a test play the
 * map's part (a pin hovered or clicked, the map moved), so no mapbox-gl or WebGL is needed.
 *
 *   jest.mock('…/map/mapSupport', () => ({ detectMapSupport: () => ({ available: true, token: 'pk.test' }) }));
 *   jest.mock('…/map/mapboxController', () => ({ createMapboxController: jest.fn() }));
 *   const maps = installFakeMap(jest.mocked(createMapboxController));
 *   …
 *   maps.current.emitClick({ type: 'location', key: 'parkstay:20' });
 */

import { act } from '@testing-library/react';
import {
  toFeatureCollection,
  type LocationFeatureCollection,
  type LocationFeatureProperties,
} from '../../../src/renderer/features/explore/map/geo';
import type { BoundingBox, LocationSummary } from '../../../src/shared/types/catalog.types';
import type {
  CreateMapController,
  MapClick,
  MapController,
  MapControllerOptions,
  MapViewState,
  PinAvailability,
} from '../../../src/renderer/features/explore/map/types';

export const WA_VIEW: MapViewState = {
  camera: { lng: 120.85, lat: -24.55, zoom: 4.2 },
  bbox: [112.5, -35.6, 129.2, -13.5],
  userInitiated: false,
};

export const KIMBERLEY_BBOX: BoundingBox = [121.5, -19.5, 129, -14];
export const SOUTH_COAST_BBOX: BoundingBox = [117, -35.5, 124.5, -32.5];

export class FakeMapController implements MapController {
  readonly options: MapControllerOptions;
  data: LocationSummary[] = [];
  setDataCalls = 0;
  /** The availability last given with the data (null: no dates). */
  availability: ReadonlyMap<string, PinAvailability> | null = null;
  /** Every pill opacity set, in order (the loading pulse). */
  pillOpacities: number[] = [];
  hovered: string | null = null;
  selected: string | null = null;
  fits: { bbox: BoundingBox; maxZoom?: number; animate?: boolean }[] = [];
  flights: { lng: number; lat: number; zoom?: number }[] = [];
  resizes = 0;
  destroyed = false;
  view: MapViewState = WA_VIEW;
  /** Where the popup's content is shown, in the document so tests can find it. */
  readonly popupHost: HTMLDivElement;
  /** Mapbox's canvas: where keyboard users pan and zoom. */
  readonly canvas: HTMLCanvasElement;
  popupAt: { lng: number; lat: number } | null = null;
  /** The place the open popup previews, if it is a preview. */
  popupPlace: string | null = null;
  overlayInsets = { top: 0 };

  private moveListeners = new Set<(view: MapViewState) => void>();
  private hoverListeners = new Set<(key: string | null) => void>();
  private clickListeners = new Set<(click: MapClick) => void>();

  constructor(options: MapControllerOptions) {
    this.options = options;
    this.popupHost = document.createElement('div');
    this.popupHost.dataset.fakeMapPopup = '';
    // A focusable canvas and the popups inside the map container, as Mapbox puts them.
    this.canvas = document.createElement('canvas');
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Map');
    options.container.append(this.canvas, this.popupHost);
  }

  setData(
    items: readonly LocationSummary[],
    availability: ReadonlyMap<string, PinAvailability> | null = null
  ) {
    this.alive('setData');
    this.data = [...items];
    this.availability = availability;
    this.setDataCalls += 1;
  }
  setPillOpacity(opacity: number) {
    this.alive('setPillOpacity');
    this.pillOpacities.push(opacity);
  }
  /**
   * The GeoJSON Mapbox would draw from the last data, as the real controller builds it, so
   * tests read each pin's `avail` and `availLabel`.
   */
  features(): LocationFeatureCollection {
    return toFeatureCollection(this.data, this.availability);
  }
  /** The properties of the pin of `key` as drawn, or undefined when it is not on the map. */
  pin(key: string): LocationFeatureProperties | undefined {
    return this.features().features.find((f) => f.properties.key === key)?.properties;
  }
  setHovered(key: string | null) {
    this.alive('setHovered');
    this.hovered = key;
  }
  setSelected(key: string | null) {
    this.alive('setSelected');
    this.selected = key;
  }
  fitBounds(bbox: BoundingBox, options: { maxZoom?: number; animate?: boolean } = {}) {
    this.alive('fitBounds');
    this.fits.push({ bbox, maxZoom: options.maxZoom, animate: options.animate });
  }
  flyTo(target: { lng: number; lat: number; zoom?: number }) {
    this.alive('flyTo');
    this.flights.push(target);
  }
  onMoveEnd(listener: (view: MapViewState) => void) {
    this.alive('onMoveEnd');
    this.moveListeners.add(listener);
    return () => this.moveListeners.delete(listener);
  }
  onFeatureHover(listener: (key: string | null) => void) {
    this.alive('onFeatureHover');
    this.hoverListeners.add(listener);
    return () => this.hoverListeners.delete(listener);
  }
  onFeatureClick(listener: (click: MapClick) => void) {
    this.alive('onFeatureClick');
    this.clickListeners.add(listener);
    return () => this.clickListeners.delete(listener);
  }
  showPopup(
    at: { lng: number; lat: number },
    content: HTMLElement,
    options: { place?: string } = {}
  ) {
    this.alive('showPopup');
    this.popupAt = at;
    this.popupPlace = options.place ?? null;
    if (content.parentElement !== this.popupHost) this.popupHost.replaceChildren(content);
  }
  hidePopup() {
    this.alive('hidePopup');
    this.popupAt = null;
    this.popupPlace = null;
    this.popupHost.replaceChildren();
  }
  setOverlayInsets(insets: { top: number }) {
    this.alive('setOverlayInsets');
    this.overlayInsets = insets;
  }
  getView() {
    this.alive('getView');
    return this.view;
  }
  resize() {
    this.alive('resize');
    this.resizes += 1;
  }
  /**
   * Like Mapbox on a removed map, a destroyed controller fails on every call, so a test fails
   * when Explore uses the map after tearing it down (the real controller ignores such calls,
   * but Explore must not rely on that).
   */
  private alive(method: string) {
    if (this.destroyed) throw new Error(`FakeMapController.${method} called after destroy()`);
  }
  destroy() {
    this.destroyed = true;
    this.canvas.remove();
    this.popupHost.remove();
  }

  /**
   * The map stopped moving at `bbox`: a person moved it, unless `userInitiated` is false (a
   * fit or a fly the app asked for).
   */
  emitMove(bbox: BoundingBox, userInitiated = true, zoom = 6) {
    const [west, south, east, north] = bbox;
    this.view = {
      camera: { lng: (west + east) / 2, lat: (south + north) / 2, zoom },
      bbox,
      userInitiated,
    };
    act(() => {
      for (const listener of [...this.moveListeners]) listener(this.view);
    });
  }
  emitHover(key: string | null) {
    act(() => {
      for (const listener of [...this.hoverListeners]) listener(key);
    });
  }
  emitClick(click: MapClick) {
    act(() => {
      for (const listener of [...this.clickListeners]) listener(click);
    });
  }
}

export interface FakeMaps {
  /** Every controller created, in order. */
  all: FakeMapController[];
  /** The latest one. */
  readonly current: FakeMapController;
}

/** Makes the mocked `createMapboxController` build FakeMapControllers. */
export function installFakeMap(create: jest.MockedFunction<CreateMapController>): FakeMaps {
  const all: FakeMapController[] = [];
  create.mockClear();
  create.mockImplementation(async (options) => {
    const controller = new FakeMapController(options);
    all.push(controller);
    return controller;
  });
  return {
    all,
    get current() {
      const latest = all[all.length - 1];
      if (!latest) throw new Error('No map was created');
      return latest;
    },
  };
}
