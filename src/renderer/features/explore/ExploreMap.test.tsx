/**
 * Explore with the map: a FakeMapController stands in for Mapbox (no WebGL under Jest), so
 * these tests drive the map's side (pins hovered and clicked, the map moved) and check the
 * list, the URL and what Explore asks of the map.
 */
import { act, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { PARKSTAY_LOCATIONS } from '../../../../tests/fixtures/catalog/parkstay-locations';
import { catalogApi, placeApi, placeNamed } from '../../../../tests/utils/renderer/catalog';
import {
  installFakeMap,
  KIMBERLEY_BBOX,
  SOUTH_COAST_BBOX,
  WA_VIEW,
  type FakeMaps,
} from '../../../../tests/utils/renderer/fakeMapController';
import { currentRoute, renderWithApp } from '../../../../tests/utils/renderer/renderWithApp';
import { boundsOf, centreOf } from './map/geo';
import { createMapboxController } from './map/mapboxController';
import { orderPlaces } from './results/order';
import { CAMERA_WRITE_DELAY_MS } from './state/useExploreParams';

// These render the whole app with 169 places: give async queries room on a busy CI runner.
configure({ asyncUtilTimeout: 4000 });

jest.mock('./map/mapSupport', () => ({
  detectMapSupport: () => ({ available: true, token: 'pk.test-token' }),
}));
jest.mock('./map/mapboxController', () => ({ createMapboxController: jest.fn() }));

let maps: FakeMaps;
let scrollIntoView: jest.Mock;

/** Pretends the window is `width` px wide for `min-width` media queries. */
function setWindowWidth(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
      return {
        matches: width >= min,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      };
    },
  });
}

beforeEach(() => {
  maps = installFakeMap(jest.mocked(createMapboxController));
  scrollIntoView = jest.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  setWindowWidth(1440);
});

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
});

const results = () => screen.getByRole('region', { name: 'Results' });
const resultsHeading = () => within(results()).getByRole('heading', { level: 2 });
const cardNames = () =>
  within(results())
    .queryAllByRole('link')
    .map((card) => card.getAttribute('aria-labelledby'))
    .map((id) => (id ? document.getElementById(id)?.textContent : null));
const mapRegion = () => screen.getByRole('region', { name: 'Map of places' });
const inRegion = (region: string) => PARKSTAY_LOCATIONS.filter((p) => p.area?.region === region);

/** Renders the app with the map and waits for the first results. */
async function renderMap(route = '/', heading: string | RegExp = '169 places') {
  const view = renderWithApp({ route, api: catalogApi() });
  await screen.findByRole('heading', { level: 2, name: heading });
  return view;
}

/**
 * Runs `moves` with fake timers, then lets more than the camera's write delay pass, so a
 * camera write the moves scheduled has certainly happened (or certainly not) by the assert.
 */
function afterCameraDelay(moves: () => void) {
  jest.useFakeTimers();
  try {
    moves();
    act(() => {
      jest.advanceTimersByTime(CAMERA_WRITE_DELAY_MS * 2);
    });
  } finally {
    jest.useRealTimers();
  }
}

/** Collects every text the results heading shows from now on. */
function watchHeading() {
  const seen: string[] = [];
  const record = () => {
    const text = within(results()).queryByRole('heading', { level: 2 })?.textContent ?? '';
    if (seen[seen.length - 1] !== text) seen.push(text);
  };
  record();
  const observer = new MutationObserver(record);
  observer.observe(results(), { childList: true, subtree: true, characterData: true });
  return { seen, stop: () => observer.disconnect() };
}

describe('Explore map', () => {
  it('draws every result on one map of WA, beside the list', async () => {
    await renderMap();
    expect(mapRegion()).toBeInTheDocument();
    expect(createMapboxController).toHaveBeenCalledTimes(1);
    expect(maps.current.options).toMatchObject({ token: 'pk.test-token', camera: null });
    // The heading and the map's data are set by separate effects: on a loaded runner the list
    // can show "169 places" a moment before the map is given them.
    await waitFor(() => expect(maps.current.data).toHaveLength(169));
    expect(screen.getByRole('switch', { name: 'Search as I move the map' })).toBeChecked();
    expect(screen.queryByText(/The map isn't available in this build/)).not.toBeInTheDocument();
  });

  it('starts at the camera in the URL, and writes the camera back after a person moves the map', async () => {
    // A camera of the person's: the list follows the map from the start.
    await renderMap('/?map=115.5,-33.5,8', '169 places in map area');
    expect(maps.current.options.camera).toEqual({ lng: 115.5, lat: -33.5, zoom: 8 });
    afterCameraDelay(() => maps.current.emitMove(KIMBERLEY_BBOX));
    expect(currentRoute()).toBe('/?map=125.25,-16.75,6');
  });

  it('never writes a camera the person did not make: the first view, a fit or a fly', async () => {
    const { user } = await renderMap();
    // The first view, reported again when the map settles.
    afterCameraDelay(() => maps.current.emitMove(WA_VIEW.bbox, false));
    expect(currentRoute()).toBe('/');

    await user.click(screen.getByRole('button', { name: 'Book online' }));
    await waitFor(() => expect(maps.current.fits).toHaveLength(1));
    afterCameraDelay(() => maps.current.emitMove(maps.current.fits[0].bbox, false));
    expect(currentRoute()).toBe('/?online=1');
  });

  it('drops the camera from the URL for a new search, which fits the map instead', async () => {
    const { user } = await renderMap('/?map=125.25,-16.75,6', /^169 places in map area$/);
    await user.click(screen.getByRole('button', { name: 'Book online' }));
    expect(currentRoute()).toBe('/?online=1');
    await waitFor(() => expect(maps.current.fits).toHaveLength(1));
  });

  it('does not let a camera still waiting to be written undo a new search', async () => {
    await renderMap();
    afterCameraDelay(() => {
      maps.current.emitMove(KIMBERLEY_BBOX);
      fireEvent.click(screen.getByRole('button', { name: 'Book online' }));
    });
    expect(currentRoute()).toBe('/?online=1');
  });

  it('does not bring back a search left with Back when the camera is written', async () => {
    const { user } = await renderMap();
    await user.click(screen.getByRole('button', { name: 'Book online' }));
    await screen.findByRole('heading', { level: 2, name: /^106 places/ });
    act(() => window.history.back());
    await screen.findByRole('heading', { level: 2, name: '169 places' });
    expect(currentRoute()).toBe('/');
    afterCameraDelay(() => maps.current.emitMove(KIMBERLEY_BBOX));
    expect(currentRoute()).toBe('/?map=125.25,-16.75,6');
  });

  it('frames the results at once when opened at a search with no camera (a link, or Back)', async () => {
    await renderMap('/?regions=Pilbara', '39 places');
    await waitFor(() => expect(maps.current.fits).toHaveLength(1));
    expect(maps.current.fits[0]).toEqual({
      bbox: boundsOf(inRegion('Pilbara')),
      maxZoom: undefined,
      animate: false,
    });
  });

  it('replaces the map data only when the set of results changes', async () => {
    const { user } = await renderMap();
    const calls = maps.current.setDataCalls;
    await user.click(screen.getByRole('button', { name: 'Book online' }));
    await screen.findByRole('heading', { level: 2, name: /^106 places/ });
    expect(maps.current.setDataCalls).toBe(calls + 1);
    expect(maps.current.data).toHaveLength(106);
    // Moving the map narrows the list, not the map's data.
    maps.current.emitMove(KIMBERLEY_BBOX);
    expect(maps.current.setDataCalls).toBe(calls + 1);
  });

  describe('hover', () => {
    /** The place on the first card. */
    const firstPlace = () => placeNamed(cardNames()[0] ?? '');

    it('highlights the pin of a hovered or focused card', async () => {
      const { user } = await renderMap();
      const place = firstPlace();
      const card = screen.getByRole('link', { name: place.name });
      await user.hover(card);
      expect(maps.current.hovered).toBe(place.key);
      await user.unhover(card);
      expect(maps.current.hovered).toBeNull();
      act(() => card.focus());
      expect(maps.current.hovered).toBe(place.key);
    });

    it('highlights the card of a hovered pin, without scrolling to it', async () => {
      await renderMap();
      const place = firstPlace();
      maps.current.emitHover(place.key);
      expect(screen.getByRole('link', { name: place.name })).toHaveAttribute(
        'data-highlighted',
        'true'
      );
      expect(scrollIntoView).not.toHaveBeenCalled();
      maps.current.emitHover(null);
      expect(screen.getByRole('link', { name: place.name })).not.toHaveAttribute(
        'data-highlighted'
      );
    });
  });

  describe('selecting a pin', () => {
    it('selects its card, scrolls to it, and opens a preview that leads to the detail page', async () => {
      const { user } = await renderMap();
      const bungarra = placeNamed('Bungarra');
      // Its card is further down the list than the first 40: it is added to the page.
      expect(screen.queryByRole('link', { name: 'Bungarra' })).not.toBeInTheDocument();
      maps.current.emitClick({ type: 'location', key: bungarra.key });

      await waitFor(() => expect(currentRoute()).toBe('/?sel=parkstay%3A20'));
      const card = screen.getByRole('link', { name: 'Bungarra' });
      expect(card).toHaveAttribute('aria-current', 'true');
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }));
      expect(maps.current.selected).toBe(bungarra.key);

      const preview = await screen.findByRole('group', { name: 'Bungarra' });
      expect(maps.current.popupAt).toEqual({ lng: bungarra.lng, lat: bungarra.lat });
      expect(mapRegion()).toContainElement(preview);
      expect(within(preview).getByText('Cape Range National Park · Pilbara')).toBeInTheDocument();
      // The provider's name shows, not only its monogram (§12.9).
      expect(within(preview).getByRole('img', { name: 'ParkStay WA' })).toHaveTextContent(
        'PSParkStay'
      );
      await user.click(within(preview).getByRole('link', { name: 'View details' }));
      expect(currentRoute()).toBe('/places/parkstay/20');
    });

    it('comes back from "View details" as it was left: search, filters, camera, selection', async () => {
      const route =
        '/?q=Cape&regions=Pilbara&arrival=2099-01-10&departure=2099-01-12&adults=2&map=113.9,-22.2,9&sel=parkstay%3A20';
      const { user } = renderWithApp({ route, api: placeApi() });
      const preview = await screen.findByRole('group', { name: 'Bungarra' });
      const left = currentRoute();
      expect(left).toBe(route);
      const details = within(preview).getByRole('link', { name: 'View details' });
      expect(details).toHaveAttribute(
        'href',
        '#/places/parkstay/20?arrival=2099-01-10&departure=2099-01-12&adults=2'
      );
      await user.click(details);
      await screen.findByRole('heading', { level: 1, name: 'Bungarra' });

      await user.click(within(screen.getByRole('main')).getByRole('link', { name: 'Explore' }));
      expect(await screen.findByRole('group', { name: 'Bungarra' })).toBeInTheDocument();
      expect(currentRoute()).toBe(left);
      expect(maps.current.options.camera).toEqual({ lng: 113.9, lat: -22.2, zoom: 9 });
      expect(screen.getByRole('combobox', { name: 'Where' })).toHaveValue('Cape');
      expect(screen.getByRole('button', { name: 'Region, 1 selected' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Bungarra' })).toHaveAttribute(
        'aria-current',
        'true'
      );
    });

    it('names the place in the preview only: no name pill on its pin while it is open', async () => {
      await renderMap();
      const bungarra = placeNamed('Bungarra');
      maps.current.emitClick({ type: 'location', key: bungarra.key });
      await screen.findByRole('group', { name: 'Bungarra' });
      expect(maps.current.popupPlace).toBe(bungarra.key);
    });

    it('returns focus to the card from "Close preview", or to the map without a card', async () => {
      const { user } = await renderMap();
      const bungarra = placeNamed('Bungarra');
      maps.current.emitClick({ type: 'location', key: bungarra.key });
      const preview = await screen.findByRole('group', { name: 'Bungarra' });
      await user.click(within(preview).getByRole('button', { name: 'Close preview' }));
      await waitFor(() => expect(currentRoute()).toBe('/'));
      expect(screen.getByRole('link', { name: 'Bungarra' })).toHaveFocus();
    });

    it('returns focus to the map when the previewed place has no card in the list', async () => {
      const kimberleyPlace = inRegion('Kimberley')[0];
      const { user } = await renderMap(
        `/?regions=Pilbara&sel=${encodeURIComponent(kimberleyPlace.key)}`,
        '39 places'
      );
      const preview = await screen.findByRole('group', { name: kimberleyPlace.name });
      await user.click(within(preview).getByRole('button', { name: 'Close preview' }));
      await waitFor(() => expect(currentRoute()).toBe('/?regions=Pilbara'));
      expect(maps.current.canvas).toHaveFocus();
    });

    it('closes the preview with Escape, or a click on empty map', async () => {
      const { user } = await renderMap();
      const bungarra = placeNamed('Bungarra');
      maps.current.emitClick({ type: 'location', key: bungarra.key });
      await screen.findByRole('group', { name: 'Bungarra' });
      await user.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByRole('group', { name: 'Bungarra' })).not.toBeInTheDocument()
      );
      expect(currentRoute()).toBe('/');

      maps.current.emitClick({ type: 'location', key: bungarra.key });
      await screen.findByRole('group', { name: 'Bungarra' });
      maps.current.emitClick({ type: 'empty' });
      await waitFor(() => expect(currentRoute()).toBe('/'));
      expect(maps.current.popupAt).toBeNull();
    });

    it('shows the full name in the preview however long it is', async () => {
      await renderMap();
      const chapman = placeNamed('Chapman Pool (formerly Warner Glen at Chapman Pool)');
      maps.current.emitClick({ type: 'location', key: chapman.key });
      const preview = await screen.findByRole('group', { name: chapman.name });
      expect(within(preview).getByText(chapman.name)).toBeInTheDocument();
    });

    it('lists places that zooming cannot separate, and selects the one chosen', async () => {
      const { user } = await renderMap();
      const [a, b] = PARKSTAY_LOCATIONS;
      maps.current.emitClick({ type: 'locations', keys: [a.key, b.key], lng: a.lng, lat: a.lat });
      const list = await screen.findByRole('group', { name: '2 places' });
      expect(within(list).getByText('2 places here')).toBeInTheDocument();
      await user.click(within(list).getByRole('button', { name: new RegExp(b.name) }));
      await waitFor(() => expect(currentRoute()).toBe(`/?sel=${encodeURIComponent(b.key)}`));
      expect(await screen.findByRole('group', { name: b.name })).toBeInTheDocument();
    });
  });

  describe('search as I move the map', () => {
    it('lists every result until the person moves the map, then the places in the map area', async () => {
      await renderMap();
      // The app's own moves (the first view, a fit) do not narrow the list.
      maps.current.emitMove(KIMBERLEY_BBOX, false);
      expect(resultsHeading()).toHaveTextContent(/^169 places$/);
      maps.current.emitMove(KIMBERLEY_BBOX);
      expect(resultsHeading()).toHaveTextContent(/^7 places in map area$/);
      expect(screen.queryByRole('button', { name: 'Search this area' })).not.toBeInTheDocument();
    });

    it('shows a new search whole at once, never the old map area, and announces it', async () => {
      const { user } = await renderMap();
      maps.current.emitMove(KIMBERLEY_BBOX);
      expect(resultsHeading()).toHaveTextContent(/^7 places in map area$/);
      const live = document.querySelector('[aria-live="polite"][aria-atomic="true"]');

      const heading = watchHeading();
      await user.click(screen.getByRole('button', { name: /^Region/ }));
      await user.click(screen.getByRole('checkbox', { name: 'South Coast, 17 places' }));
      await waitFor(() => expect(resultsHeading()).toHaveTextContent(/^17 places$/));
      // The fit to the South Coast lands: still the whole search, not "in map area".
      await waitFor(() => expect(maps.current.fits).toHaveLength(1));
      expect(maps.current.fits[0].bbox).toEqual(boundsOf(inRegion('South Coast')));
      maps.current.emitMove(SOUTH_COAST_BBOX, false);
      await waitFor(() => expect(live?.textContent?.trim()).toBe('17 places'));
      heading.stop();
      expect(heading.seen).not.toContain('No places in this part of the map');
      expect(heading.seen.filter((text) => /in map area/.test(text))).toEqual([
        '7 places in map area',
      ]);
    });

    it('offers "Search this area" when off, and narrows only when it is applied', async () => {
      const { user } = await renderMap();
      await user.click(screen.getByRole('switch', { name: 'Search as I move the map' }));
      expect(currentRoute()).toBe('/?follow=0');
      maps.current.emitMove(KIMBERLEY_BBOX);
      expect(resultsHeading()).toHaveTextContent(/^169 places$/);
      await user.click(screen.getByRole('button', { name: 'Search this area' }));
      expect(resultsHeading()).toHaveTextContent(/^7 places in map area$/);
      expect(screen.queryByRole('button', { name: 'Search this area' })).not.toBeInTheDocument();
    });

    /** Open sea east of Victoria: no place of WA's in it. */
    const EMPTY_SEA: [number, number, number, number] = [150, -40, 155, -35];
    const SHOW_ALL_FIT = {
      bbox: [112.5, -35.6, 129.2, -13.5],
      maxZoom: undefined,
      animate: undefined,
    };

    it('says when no place is in the map area, and shows all of WA again', async () => {
      await renderMap();
      // Fake timers: the move's camera write is still waiting when the button is pressed, as
      // it is for a person, however slow the machine running the test.
      afterCameraDelay(() => {
        maps.current.emitMove(EMPTY_SEA);
        expect(
          screen.getByRole('heading', { name: 'No places in this part of the map' })
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Show all of WA' }));
      });
      expect(maps.current.fits.at(-1)).toEqual(SHOW_ALL_FIT);
      expect(resultsHeading()).toHaveTextContent(/^169 places$/);
      expect(currentRoute()).not.toContain('map=');
    });

    it('"Show all of WA" also drops a camera already written to the URL', async () => {
      const { user } = await renderMap();
      afterCameraDelay(() => maps.current.emitMove(EMPTY_SEA));
      expect(currentRoute()).toBe('/?map=152.5,-37.5,6');
      await user.click(screen.getByRole('button', { name: 'Show all of WA' }));
      expect(maps.current.fits.at(-1)).toEqual(SHOW_ALL_FIT);
      expect(resultsHeading()).toHaveTextContent(/^169 places$/);
      expect(currentRoute()).toBe('/');
    });

    it('"Show all of WA" drops a camera written the moment before, while the page has not redrawn yet', async () => {
      await renderMap();
      jest.useFakeTimers();
      try {
        maps.current.emitMove(EMPTY_SEA);
        const showAll = screen.getByRole('button', { name: 'Show all of WA' });
        // One act: the camera write lands, then the click, before React renders the write
        act(() => {
          jest.advanceTimersByTime(CAMERA_WRITE_DELAY_MS);
          expect(currentRoute()).toBe('/?map=152.5,-37.5,6');
          fireEvent.click(showAll);
        });
        act(() => {
          jest.advanceTimersByTime(CAMERA_WRITE_DELAY_MS * 2);
        });
      } finally {
        jest.useRealTimers();
      }
      expect(maps.current.fits.at(-1)).toEqual(SHOW_ALL_FIT);
      expect(resultsHeading()).toHaveTextContent(/^169 places$/);
      expect(currentRoute()).toBe('/');
    });
  });

  describe('order', () => {
    it('lists the places nearest the middle of the map first, then of the map area', async () => {
      await renderMap();
      const nearest = (centre: [number, number]) =>
        orderPlaces(PARKSTAY_LOCATIONS, centre)
          .slice(0, 3)
          .map((p) => p.name);
      // Not "14 Mile" and "3 Mile Camp" (the A to Z start): the middle of WA's places.
      expect(cardNames().slice(0, 3)).toEqual(nearest(centreOf(boundsOf(PARKSTAY_LOCATIONS)!)));
      expect(cardNames()[0]).not.toBe('14 Mile');

      maps.current.emitMove(KIMBERLEY_BBOX);
      const kimberley = orderPlaces(inRegion('Kimberley'), centreOf(KIMBERLEY_BBOX));
      expect(cardNames()).toEqual(kimberley.map((p) => p.name));
    });

    it('keeps the order of a text search (most relevant first)', async () => {
      const { user } = await renderMap();
      await user.type(screen.getByRole('combobox', { name: 'Where' }), 'Cape');
      await waitFor(() => expect(resultsHeading()).toHaveTextContent(/^21 places$/));
      const relevance = PARKSTAY_LOCATIONS.filter((p) =>
        [p.name, p.area?.name, p.area?.region].some((f) => f?.toLowerCase().includes('cape'))
      );
      expect(cardNames()).toEqual(relevance.map((p) => p.name));
    });
  });

  describe('fitting the results', () => {
    it('fits the map to the results of a new filter, not on the first load', async () => {
      const { user } = await renderMap();
      expect(maps.current.fits).toEqual([]);
      await user.click(screen.getByRole('button', { name: /^Region/ }));
      await user.click(screen.getByRole('checkbox', { name: 'Pilbara, 39 places' }));
      await waitFor(() => expect(maps.current.fits).toHaveLength(1));
      const pilbara = PARKSTAY_LOCATIONS.filter((p) => p.area?.region === 'Pilbara');
      expect(maps.current.fits[0].bbox).toEqual(boundsOf(pilbara));
    });

    it('fits the map to a region chosen in Where', async () => {
      const { user } = await renderMap();
      await user.type(screen.getByRole('combobox', { name: 'Where' }), 'Kimb');
      await user.click(screen.getByRole('option', { name: /Kimberley/ }));
      await waitFor(() => expect(maps.current.fits).toHaveLength(1));
      const kimberley = PARKSTAY_LOCATIONS.filter((p) => p.area?.region === 'Kimberley');
      expect(maps.current.fits[0].bbox).toEqual(boundsOf(kimberley));
    });

    it('leaves the camera alone when nothing matches', async () => {
      const { user } = await renderMap();
      await user.type(screen.getByRole('combobox', { name: 'Where' }), 'zzzz{Enter}');
      await screen.findByRole('heading', { name: 'No places match your search' });
      expect(maps.current.fits).toEqual([]);
    });

    it('flies to a place chosen in Where, without fitting', async () => {
      const { user } = await renderMap();
      const lucky = placeNamed('Lucky Bay (Cape Le Grand)');
      await user.type(screen.getByRole('combobox', { name: 'Where' }), 'Lucky');
      await waitFor(() => expect(currentRoute()).toContain('q=Lucky'));
      await user.click(screen.getByRole('option', { name: /Lucky Bay \(Cape Le Grand\)/ }));
      await waitFor(() => expect(currentRoute()).toContain(`sel=${encodeURIComponent(lucky.key)}`));
      expect(currentRoute()).not.toContain('q=');
      // The person chose where the map goes: the camera is in the URL at once, with the place.
      const fixed = (n: number) => String(Number(n.toFixed(5)));
      expect(currentRoute()).toContain(`map=${fixed(lucky.lng)},${fixed(lucky.lat)},12`);
      expect(maps.current.flights).toEqual([{ lng: lucky.lng, lat: lucky.lat, zoom: 12 }]);
      await screen.findByRole('heading', { level: 2, name: '169 places' });
      // The text typed to find it was a search (fitted); clearing it again is not.
      expect(maps.current.fits).toHaveLength(1);
      // The fit for the typed text, cut short by the fly, ends first: the list stays whole.
      maps.current.emitMove(KIMBERLEY_BBOX, false);
      expect(resultsHeading()).toHaveTextContent(/^169 places$/);
      // Landed: the list follows the map there.
      const around: [number, number, number, number] = [
        lucky.lng - 0.1,
        lucky.lat - 0.1,
        lucky.lng + 0.1,
        lucky.lat + 0.1,
      ];
      maps.current.emitMove(around, false, 12);
      expect(resultsHeading()).toHaveTextContent(/places? in map area$/);
      expect(cardNames()[0]).toBe(lucky.name);
    });
  });

  describe('below 1024 px', () => {
    it('shows one pane at a time, keeping the map mounted, and moves focus to the revealed pane', async () => {
      setWindowWidth(1000);
      const { user } = await renderMap();
      const map = maps.current;
      expect(createMapboxController).toHaveBeenCalledTimes(1);
      const toggle = screen.getByRole('button', { name: 'Show map' });
      await user.click(toggle);
      expect(currentRoute()).toBe('/?view=map');
      await waitFor(() =>
        expect(screen.getByRole('heading', { level: 2, name: 'Map of places' })).toHaveFocus()
      );
      expect(map.resizes).toBeGreaterThan(0);

      await user.click(screen.getByRole('button', { name: 'Show list' }));
      await waitFor(() => expect(resultsHeading()).toHaveFocus());
      expect(createMapboxController).toHaveBeenCalledTimes(1);
      expect(map.destroyed).toBe(false);
    });

    it('has no toggle at 1024 px and wider', async () => {
      await renderMap();
      expect(screen.queryByRole('button', { name: 'Show map' })).not.toBeInTheDocument();
    });
  });

  describe('failures', () => {
    it('falls back to the list when the map cannot load, and can try again', async () => {
      jest
        .mocked(createMapboxController)
        .mockRejectedValueOnce(new Error("The map couldn't load: 401 Unauthorized"));
      const { user } = renderWithApp({ api: catalogApi() });
      expect(
        await screen.findByText("The map couldn't load, so places are shown as a list.")
      ).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Map of places' })).not.toBeInTheDocument();
      expect(resultsHeading()).toHaveTextContent(/^169 places$/);

      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('region', { name: 'Map of places' })).toBeInTheDocument();
      await waitFor(() => expect(maps.all).toHaveLength(1));
    });

    it('removes the map when Explore closes', async () => {
      const { unmount } = await renderMap();
      const map = maps.current;
      unmount();
      expect(map.destroyed).toBe(true);
    });
  });

  it('puts the search pill, then the filters, then the results, then the map in tab order', async () => {
    await renderMap();
    const order = [
      screen.getByRole('search', { name: 'Search places' }),
      screen.getByRole('group', { name: 'Filters' }),
      results(),
      mapRegion(),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  });
});
