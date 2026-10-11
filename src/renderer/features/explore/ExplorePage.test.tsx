/**
 * Explore in list-only mode (no Mapbox token under Jest): search, filters, the results and
 * every state, through the whole app with a mocked `window.api`.
 */
import { act, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  catalogApi,
  failedStatus,
  pendingStatus,
  placeApi,
  placeNamed,
  searchStub,
  syncingStatus,
} from '../../../../tests/utils/renderer/catalog';
import { fail, ok } from '../../../../tests/utils/renderer/createMockApi';
import { currentRoute, renderWithApp } from '../../../../tests/utils/renderer/renderWithApp';
import { PARKSTAY_LOCATIONS } from '../../../../tests/fixtures/catalog/parkstay-locations';
import { format, parseISO } from 'date-fns';
import { addDays, todayIn } from '../../../shared/utils/calendar-date';
import { createMapboxController } from './map/mapboxController';

// These render the whole app with 169 places: give async queries room on a busy CI runner.
configure({ asyncUtilTimeout: 4000 });

jest.mock('./map/mapboxController', () => ({ createMapboxController: jest.fn() }));

const results = () => screen.getByRole('region', { name: 'Results' });
const resultsHeading = () => within(results()).getByRole('heading', { level: 2 });
const cards = () => within(results()).queryAllByRole('link');
const chip = (name: string | RegExp) =>
  within(screen.getByRole('group', { name: 'Filters' })).getByRole('button', { name });
const where = () => screen.getByRole('combobox', { name: 'Where' });

/** Renders the app at `route` and waits for the first results. */
async function renderExplore(
  route = '/',
  api = catalogApi(),
  heading: string | RegExp = '169 places'
) {
  const view = renderWithApp({ route, api });
  await screen.findByRole('heading', { level: 2, name: heading });
  return view;
}

/** Errors take a moment: most queries retry once first. */
const SLOW = { timeout: 4000 };

/** Ticks options in a filter chip's popover, then closes it with Done. */
async function choose(
  user: ReturnType<typeof renderWithApp>['user'],
  chipName: string,
  options: string[]
) {
  await user.click(chip(new RegExp(`^${chipName}`)));
  const popover = screen.getByRole('dialog', { name: chipName });
  for (const option of options) {
    await user.click(within(popover).getByRole('checkbox', { name: new RegExp(`^${option},`) }));
  }
  await user.click(within(popover).getByRole('button', { name: 'Done' }));
}

describe('Explore (list-only)', () => {
  it('is the home page: a hidden h1, the search pill, the filter chips and every place', async () => {
    const { mock } = await renderExplore();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Explore places to stay' })
    ).toBeInTheDocument();
    expect(screen.getByRole('search', { name: 'Search places' })).toBeInTheDocument();
    expect(where()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^When/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Who/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    const filters = screen.getByRole('group', { name: 'Filters' });
    expect(
      within(filters)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Provider', 'Type', 'Region', 'Facilities', 'Book online', 'Available only']);
    expect(resultsHeading()).toHaveTextContent('169 places');
    // 40 cards first.
    expect(cards()).toHaveLength(40);
    expect(mock?.api.catalog.search).toHaveBeenCalledWith({ limit: 5000 });
  });

  it('shows the list-only notice and no map at all without a token', async () => {
    await renderExplore();
    expect(
      screen.getByText(/The map isn't available in this build, so places are shown as a list\./)
    ).toBeInTheDocument();
    // Development builds say how to turn it on.
    expect(screen.getByText(/Set MAPBOX_ACCESS_TOKEN in \.env to enable it\./)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Map of places' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('switch', { name: 'Search as I move the map' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show map/ })).not.toBeInTheDocument();
    expect(createMapboxController).not.toHaveBeenCalled();
  });

  it('lists places A to Z without a map, names that start with a number last', async () => {
    const { user } = await renderExplore();
    const names = () =>
      cards().map(
        (card) => document.getElementById(card.getAttribute('aria-labelledby')!)?.textContent
      );
    expect(names().slice(0, 3)).toEqual(['Amherst Point', 'Baden Powell', 'Bald Hill']);
    for (let page = 0; page < 4; page += 1) {
      await user.click(screen.getByRole('button', { name: 'Show more places' }));
    }
    expect(names().slice(-2)).toEqual(['3 Mile Camp', '14 Mile']);
  });

  it('adds 40 more cards with "Show more places"', async () => {
    const { user } = await renderExplore();
    expect(screen.getByText('Showing 40 of 169')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show more places' }));
    expect(cards()).toHaveLength(80);
  });

  it('searches the text typed in Where after a pause, and a reload restores it', async () => {
    const { user, mock, unmount } = await renderExplore();
    await user.type(where(), 'Cape');
    await waitFor(() => expect(currentRoute()).toBe('/?q=Cape'));
    await waitFor(() =>
      expect(mock?.api.catalog.search).toHaveBeenCalledWith({ text: 'Cape', limit: 5000 })
    );
    // Debounced: no search for the partial words.
    expect(mock?.api.catalog.search).not.toHaveBeenCalledWith({ text: 'Cap', limit: 5000 });
    await waitFor(() => expect(resultsHeading()).toHaveTextContent(/^21 places$/));
    unmount();

    const again = renderWithApp({ route: '/?q=Cape', api: catalogApi() });
    expect(await screen.findByRole('heading', { level: 2, name: '21 places' })).toBeInTheDocument();
    expect(where()).toHaveValue('Cape');
    expect(again.mock?.api.catalog.search).toHaveBeenCalledWith({ text: 'Cape', limit: 5000 });
  });

  it('searches at once on Enter, and passes search syntax through untouched', async () => {
    const { user, mock } = await renderExplore();
    await user.type(where(), '"Cape" AND -bay*{Enter}');
    expect(currentRoute()).toContain('q=%22Cape%22+AND+-bay*');
    expect(mock?.api.catalog.search).toHaveBeenCalledWith({
      text: '"Cape" AND -bay*',
      limit: 5000,
    });
  });

  it('filters by region: 39 in the Pilbara, the chip reads "Region · 1", Clear all restores 169', async () => {
    const { user } = await renderExplore();
    const region = chip('Region');
    expect(region).toHaveAttribute('aria-expanded', 'false');
    await user.click(region);
    expect(region).toHaveAttribute('aria-expanded', 'true');
    const popover = screen.getByRole('dialog', { name: 'Region' });
    expect(
      within(popover).getByRole('checkbox', { name: 'Pilbara, 39 places' })
    ).toBeInTheDocument();
    await user.click(within(popover).getByRole('checkbox', { name: 'Pilbara, 39 places' }));
    await user.click(within(popover).getByRole('button', { name: 'Done' }));

    // Closing the popover returns focus to its chip.
    const chosen = chip('Region, 1 selected');
    expect(chosen).toHaveFocus();
    expect(chosen).toHaveTextContent(/^Region· 1$/);
    expect(currentRoute()).toBe('/?regions=Pilbara');
    await waitFor(() => expect(resultsHeading()).toHaveTextContent(/^39 places$/));

    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(resultsHeading()).toHaveTextContent(/^169 places$/));
    expect(currentRoute()).toBe('/');
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();
  });

  it('closes a filter popover with Escape, back on its chip', async () => {
    const { user } = await renderExplore();
    await user.click(chip('Facilities'));
    expect(screen.getByRole('dialog', { name: 'Facilities' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Facilities' })).not.toBeInTheDocument();
    expect(chip('Facilities')).toHaveFocus();
  });

  it('needs every chosen facility: Dogs permitted and Toilet gives only places with both', async () => {
    const { user } = await renderExplore();
    await choose(user, 'Facilities', ['Dogs permitted', 'Toilet']);
    await waitFor(() => expect(resultsHeading()).toHaveTextContent(/^23 places$/));
    expect(chip('Facilities, 2 selected')).toBeInTheDocument();
    const both = PARKSTAY_LOCATIONS.filter(
      (p) => p.amenities.includes('Dogs permitted') && p.amenities.includes('Toilet')
    ).map((p) => p.name);
    for (const card of cards()) {
      expect(both).toContain(within(card).getAllByText(/./)[0].textContent);
      expect(within(card).getByText('Dogs permitted')).toBeInTheDocument();
      expect(within(card).getByText('Toilet')).toBeInTheDocument();
    }
  });

  it('shows only the 106 places bookable online with "Book online" pressed', async () => {
    const { user, mock } = await renderExplore();
    const toggle = chip('Book online');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(resultsHeading()).toHaveTextContent(/^106 places$/));
    expect(mock?.api.catalog.search).toHaveBeenCalledWith({
      bookingModes: ['online'],
      limit: 5000,
    });
    expect(currentRoute()).toBe('/?online=1');
  });

  it('filters by type, and hides the Type chip when every place is the same kind', async () => {
    const { user, unmount } = await renderExplore();
    await choose(user, 'Type', ['Holiday park']);
    await waitFor(() => expect(resultsHeading()).toHaveTextContent(/^5 places$/));
    expect(currentRoute()).toBe('/?kinds=holiday-park');
    unmount();

    const campgrounds = PARKSTAY_LOCATIONS.filter((p) => p.kind === 'campground');
    await renderExplore('/', catalogApi({ items: campgrounds }), '139 places');
    expect(screen.queryByRole('button', { name: /^Type/ })).not.toBeInTheDocument();
  });

  it('always shows the Provider chip, with the one catalogue provider', async () => {
    const { user } = await renderExplore();
    await user.click(chip('Provider'));
    expect(
      within(screen.getByRole('dialog', { name: 'Provider' })).getByRole('checkbox', {
        name: 'ParkStay WA, 169 places',
      })
    ).toBeInTheDocument();
  });

  it('sets the region filter from the "Pilbara" Where suggestion', async () => {
    const { user } = await renderExplore();
    await user.type(where(), 'Pilb');
    const listbox = screen.getByRole('listbox', { name: 'Where' });
    const option = within(listbox).getByRole('option', { name: /Pilbara/ });
    expect(within(listbox).getByRole('group', { name: 'Regions' })).toContainElement(option);
    expect(option).toHaveTextContent('Region · 39 places');
    await user.click(option);
    await waitFor(() => expect(resultsHeading()).toHaveTextContent(/^39 places$/));
    expect(currentRoute()).toBe('/?regions=Pilbara');
    expect(chip('Region, 1 selected')).toBeInTheDocument();
    expect(where()).toHaveValue('');
  });

  it('selects a place from a Where suggestion and brings its card into view', async () => {
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { user } = await renderExplore();
    const lucky = placeNamed('Lucky Bay (Cape Le Grand)');
    await user.type(where(), 'Lucky');
    await user.click(screen.getByRole('option', { name: /Lucky Bay \(Cape Le Grand\)/ }));
    await waitFor(() => expect(currentRoute()).toBe(`/?sel=${encodeURIComponent(lucky.key)}`));
    const card = await screen.findByRole('link', { name: lucky.name });
    expect(card).toHaveAttribute('aria-current', 'true');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }));
  });

  it('searches at once with the Search button', async () => {
    const { user, mock } = await renderExplore();
    await user.type(where(), 'Gorge');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(currentRoute()).toBe('/?q=Gorge');
    expect(mock?.api.catalog.search).toHaveBeenCalledWith({ text: 'Gorge', limit: 5000 });
  });

  it('offers dates from today in Perth, for stays of up to 30 nights', async () => {
    const { user } = await renderExplore();
    await user.click(screen.getByRole('button', { name: /^When/ }));
    const dates = screen.getByRole('dialog', { name: 'Choose dates' });
    const today = todayIn('Australia/Perth');
    const yesterday = addDays(today, -1);
    const label = (date: string) => format(parseISO(date), 'EEEE d MMMM yyyy');
    if (yesterday.slice(0, 7) === today.slice(0, 7)) {
      expect(within(dates).getByRole('button', { name: label(yesterday) })).toHaveAttribute(
        'aria-disabled',
        'true'
      );
    }
    await user.click(within(dates).getByRole('button', { name: label(today) }));
    expect(
      within(dates).getByText('Stays can be up to 30 nights, so later dates are unavailable.')
    ).toBeInTheDocument();
  });

  it('drops invalid URL values and rewrites the address in place', async () => {
    await renderExplore(
      '/?regions=Pilbara,Atlantis&kinds=castle&adults=99&online=1',
      catalogApi(),
      /places$/
    );
    await waitFor(() => expect(currentRoute()).toBe('/?regions=Pilbara&online=1'));
  });

  it('keeps dates and guests in the URL for the detail page', async () => {
    const { user } = await renderExplore(
      '/?arrival=2099-01-10&departure=2099-01-12&adults=2',
      catalogApi(),
      /^169 places · \d+ available for 10–12 Jan$/
    );
    await waitFor(() =>
      expect(currentRoute()).toBe('/?arrival=2099-01-10&departure=2099-01-12&adults=2')
    );
    expect(screen.getByRole('button', { name: /^When/ })).toHaveTextContent('Sat 10 – Mon 12 Jan');
    expect(screen.getByRole('button', { name: /^Who/ })).toHaveTextContent('2 adults');
    await user.click(screen.getByRole('button', { name: /^Who/ }));
    await user.click(screen.getByRole('button', { name: 'Increase children' }));
    expect(currentRoute()).toBe(
      '/?arrival=2099-01-10&departure=2099-01-12&adults=2&children=1&infants=0'
    );
  });
});

describe('Explore cards', () => {
  it('links each card to its detail page, named by the place, with its details', async () => {
    const { user } = await renderExplore();
    const bungarra = placeNamed('Bungarra');
    const card = screen.getByRole('link', { name: 'Bungarra' });
    expect(card).toHaveAttribute('href', `#/places/parkstay/${bungarra.externalId}`);
    expect(card).toHaveAccessibleDescription(/Cape Range National Park · Pilbara/);
    expect(within(card).getByRole('img', { name: 'ParkStay WA' })).toBeInTheDocument();
    expect(within(card).getByText('Campground')).toBeInTheDocument();
    expect(within(card).getByText('Book online')).toBeInTheDocument();
    expect(within(card).getByText('5 sites')).toBeInTheDocument();
    expect(within(card).getByText('Toilet')).toBeInTheDocument();
    expect(within(card).getByText('Road access for 2WD/SUV')).toBeInTheDocument();
    await user.click(card);
    expect(currentRoute()).toBe(`/places/parkstay/${bungarra.externalId}`);
  });

  it('keeps a place with no map position in the list, saying so', async () => {
    const lost = { ...placeNamed('Bungarra'), lat: Number.NaN, lng: Number.NaN };
    const others = PARKSTAY_LOCATIONS.filter((p) => p.key !== lost.key);
    await renderExplore('/', catalogApi({ items: [lost, ...others] }));
    const card = screen.getByRole('link', { name: 'Bungarra' });
    expect(within(card).getByText('No map location')).toBeInTheDocument();
  });

  it('marks places that are not bookable online "Info only"', async () => {
    await renderExplore();
    const offline = PARKSTAY_LOCATIONS.find((p) => p.bookingMode === 'external')!;
    expect(
      within(screen.getByRole('link', { name: offline.name })).getByText('Info only')
    ).toBeInTheDocument();
  });

  it('falls back to the photo placeholder when an image fails to load', async () => {
    await renderExplore();
    const card = screen.getByRole('link', { name: 'Bungarra' });
    const image = card.querySelector('img');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(image).toHaveAttribute('loading', 'lazy');
    fireEvent.error(image!);
    expect(
      within(card).getByRole('img', { name: 'No photo available for Bungarra' })
    ).toBeInTheDocument();
    expect(card.querySelector('img')).toBeNull();
  });

  it('clamps a 51-character name on the card but names the link in full', async () => {
    await renderExplore('/?regions=South+West', catalogApi(), '26 places');
    const name = 'Chapman Pool (formerly Warner Glen at Chapman Pool)';
    expect(await screen.findByRole('link', { name })).toBeInTheDocument();
  });
});

describe('Explore and the detail page', () => {
  let scrollTo: jest.SpyInstance;
  beforeEach(() => {
    scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation((_x?: unknown, y?: unknown) => {
      window.scrollY = Number(y);
    });
  });
  afterEach(() => {
    scrollTo.mockRestore();
    window.scrollY = 0;
  });

  it("opens a place with Explore's dates and guests", async () => {
    // (With dates the list puts available places first, so search for the place.)
    await renderExplore(
      '/?q=Bungarra&arrival=2099-01-10&departure=2099-01-12&adults=2&children=1',
      catalogApi(),
      '1 place · 1 available for 10–12 Jan'
    );
    expect(screen.getAllByRole('link', { name: 'Bungarra' })[0]).toHaveAttribute(
      'href',
      '#/places/parkstay/20?arrival=2099-01-10&departure=2099-01-12&adults=2&children=1'
    );
  });

  it('comes back from a place where the list was left: scrolled, and with its extra cards', async () => {
    const { user } = await renderExplore('/', placeApi());
    await user.click(screen.getByRole('button', { name: 'Show more places' }));
    expect(cards()).toHaveLength(80);
    window.scrollY = 2400;
    fireEvent.scroll(window);
    await waitFor(() =>
      expect(JSON.parse(window.sessionStorage.getItem('ws:explore:scroll:') ?? '{}')).toEqual({
        y: 2400,
        shown: 80,
      })
    );

    const bungarra = placeNamed('Bungarra');
    await user.click(screen.getByRole('link', { name: bungarra.name }));
    await screen.findByRole('heading', { level: 1, name: 'Bungarra' });
    window.scrollY = 0;
    await user.click(within(screen.getByRole('main')).getByRole('link', { name: 'Explore' }));

    await screen.findByRole('heading', { level: 2, name: '169 places' });
    expect(cards()).toHaveLength(80);
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(0, 2400));
  });

  it('starts at the top on a new visit, whatever was saved', async () => {
    window.sessionStorage.setItem('ws:explore:scroll:', JSON.stringify({ y: 900, shown: 80 }));
    window.scrollY = 300;
    const { user } = renderWithApp({ route: '/watches', api: catalogApi() });
    await screen.findByRole('heading', { level: 1 });
    await user.click(
      within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', {
        name: 'Explore',
      })
    );
    await screen.findByRole('heading', { level: 2, name: '169 places' });
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(cards()).toHaveLength(40);
  });
});

describe('Explore states', () => {
  it('shows 8 skeletons with the results busy while loading', async () => {
    renderWithApp({
      api: catalogApi({ catalog: { search: jest.fn(() => new Promise(() => undefined)) } }),
    });
    await screen.findByRole('heading', { level: 2, name: 'Loading places' });
    expect(results()).toHaveAttribute('aria-busy', 'true');
    expect(within(results()).getAllByRole('listitem')).toHaveLength(8);
  });

  it('says "Getting places ready" while the catalogue syncs', async () => {
    renderWithApp({
      api: catalogApi({ items: [], status: syncingStatus() }),
    });
    expect(
      await screen.findByRole('heading', { name: 'Getting places ready' })
    ).toBeInTheDocument();
    expect(results()).toHaveAttribute('aria-busy', 'true');
  });

  it('waits for the first sync, then shows the places it brought', async () => {
    const search = jest.fn().mockResolvedValue(ok({ items: [], total: 0 }));
    const { mock } = renderWithApp({
      api: catalogApi({ status: pendingStatus(), catalog: { search } }),
    });
    expect(
      await screen.findByRole('heading', { name: 'Getting places ready' })
    ).toBeInTheDocument();
    expect(screen.queryByText("We couldn't load places")).not.toBeInTheDocument();

    search.mockImplementation(searchStub().getMockImplementation()!);
    mock!.emit('catalog:updated', {
      providerId: 'parkstay',
      count: 169,
      syncedAt: '2026-10-04T01:00:00Z',
    });
    expect(
      await screen.findByRole('heading', { level: 2, name: '169 places' })
    ).toBeInTheDocument();
  });

  it('offers "Try again" when the sync failed, which re-syncs the catalogue', async () => {
    const { user, mock } = renderWithApp({
      api: catalogApi({ items: [], status: failedStatus() }),
    });
    expect(
      await screen.findByRole('heading', { name: "We couldn't load places" })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mock?.api.catalog.refresh).toHaveBeenCalledTimes(1);
  });

  it('offers "Try again" when the search itself fails with nothing to show', async () => {
    const { user, mock } = renderWithApp({
      api: catalogApi({
        catalog: { search: jest.fn().mockResolvedValue(fail('Database locked')) },
      }),
    });
    expect(
      await screen.findByRole('heading', { name: "We couldn't load places" }, SLOW)
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mock?.api.catalog.refresh).toHaveBeenCalled();
  });

  it('says places are not available yet while the catalogue is not built (NOT_IMPLEMENTED)', async () => {
    renderWithApp({
      api: catalogApi({
        catalog: {
          search: jest
            .fn()
            .mockResolvedValue(
              fail('The location catalogue is not available yet', 'NOT_IMPLEMENTED')
            ),
        },
      }),
    });
    expect(
      await screen.findByRole('heading', { name: "Places aren't available yet" })
    ).toBeInTheDocument();
  });

  it('says so when no installed provider lists places', async () => {
    renderWithApp({
      api: catalogApi({ stubs: { providers: { list: jest.fn().mockResolvedValue(ok([])) } } }),
    });
    expect(
      await screen.findByRole('heading', { name: 'No providers with places are installed' })
    ).toBeInTheDocument();
  });

  it('shows "No places match your search" with "Clear filters" when nothing matches', async () => {
    const { user } = await renderExplore();
    await user.type(where(), 'zzzz{Enter}');
    expect(
      await screen.findByRole('heading', { name: 'No places match your search' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(resultsHeading()).toHaveTextContent(/^169 places$/));
    expect(where()).toHaveValue('');
  });

  it('keeps the last results and shows a danger notice with Retry when a search fails', async () => {
    const search = jest.fn(async (query: { text?: string }) =>
      query.text ? fail("ParkStay didn't respond") : ok({ items: PARKSTAY_LOCATIONS, total: 169 })
    );
    const { user } = await renderExplore('/', catalogApi({ catalog: { search } }));
    await user.type(where(), 'Cape{Enter}');
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(alert).toHaveTextContent("We couldn't update the results");
    expect(resultsHeading()).toHaveTextContent('169 places');
    search.mockClear();
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(search).toHaveBeenCalledWith({ text: 'Cape', limit: 5000 });
  });

  it('says so when offline', async () => {
    const onLine = jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    await renderExplore();
    expect(
      screen.getByText("You're offline. Showing saved places; photos and map tiles may not load.")
    ).toBeInTheDocument();
    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();
    onLine.mockRestore();
  });

  it('refreshes the results in place when the catalogue updates', async () => {
    const { mock } = await renderExplore();
    const calls = jest.mocked(mock!.api.catalog.search).mock.calls.length;
    mock!.emit('catalog:updated', {
      providerId: 'parkstay',
      count: 169,
      syncedAt: '2026-10-04T01:00:00Z',
    });
    await waitFor(() =>
      expect(jest.mocked(mock!.api.catalog.search).mock.calls.length).toBeGreaterThan(calls)
    );
    expect(resultsHeading()).toHaveTextContent('169 places');
  });
});

describe('Explore announcements', () => {
  it('announces the new count politely after a filter change', async () => {
    const { user } = await renderExplore();
    const live = document.querySelector('[aria-live="polite"][aria-atomic="true"]');
    await user.click(chip('Book online'));
    await waitFor(() => expect(live?.textContent?.trim()).toBe('106 places'));
  });
});
