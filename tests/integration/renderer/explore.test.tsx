/**
 * The Explore journey through the whole renderer: the shell opens on Explore, a search, a
 * region filter, then a card to its detail page, a check of its dates, the hand-off to the
 * new watch flow (filled in), and back to Explore as it was left. Dates on Explore,
 * availability on the cards and "Available only" (E3). And Explore with 5,000 places.
 */
import { act, configure, screen, waitFor, within } from '@testing-library/react';
import { stayRangeLabel } from '../../../src/renderer/components/nightGridModel';
import { shortRange } from '../../../src/renderer/components/ui/calendar';
import { addDays, todayIn } from '../../../src/shared/utils/calendar-date';
import { bulkAvailabilityFor } from '../../fixtures/catalog/bulk-availability';
import { PARKSTAY_LOCATIONS } from '../../fixtures/catalog/parkstay-locations';
import { SYNTHETIC_LOCATIONS_5K } from '../../fixtures/catalog/synthetic-locations';
import { catalogApi, placeApi } from '../../utils/renderer/catalog';
import { currentRoute, renderWithApp } from '../../utils/renderer/renderWithApp';

// These render the whole app with 169 (and 5,000) places: give async queries room on a busy
// runner, as the Explore suites do.
configure({ asyncUtilTimeout: 4000 });

describe('Explore journey', () => {
  it('searches, filters by region and opens a place', async () => {
    const { user, mock } = renderWithApp({ route: '/', api: catalogApi() });

    // The shell opens straight on Explore.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Explore places to stay' })
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', {
        name: 'Explore',
      })
    ).toHaveAttribute('aria-current', 'page');
    const results = screen.getByRole('region', { name: 'Results' });
    expect(await within(results).findByRole('heading', { name: '169 places' })).toBeInTheDocument();

    // Search.
    await user.type(screen.getByRole('combobox', { name: 'Where' }), 'National Park{Enter}');
    await waitFor(() =>
      expect(mock?.api.catalog.search).toHaveBeenCalledWith({ text: 'National Park', limit: 5000 })
    );
    const matching = PARKSTAY_LOCATIONS.filter((p) => /national park/i.test(p.area?.name ?? ''));
    expect(
      await within(results).findByRole('heading', { name: `${matching.length} places` })
    ).toBeInTheDocument();

    // Region filter.
    await user.click(screen.getByRole('button', { name: /^Region/ }));
    const region = screen.getByRole('dialog', { name: 'Region' });
    const kimberley = matching.filter((p) => p.area?.region === 'Kimberley');
    await user.click(
      within(region).getByRole('checkbox', { name: `Kimberley, ${kimberley.length} places` })
    );
    await user.click(within(region).getByRole('button', { name: 'Done' }));
    expect(
      await within(results).findByRole('heading', { name: `${kimberley.length} places` })
    ).toBeInTheDocument();
    expect(currentRoute()).toBe('/?q=National+Park&regions=Kimberley');

    // Open a card.
    const [first] = kimberley;
    await user.click(within(results).getByRole('link', { name: first.name }));
    expect(currentRoute()).toBe(`/places/parkstay/${first.externalId}`);

    // Back returns to the same search.
    window.history.back();
    expect(
      await screen.findByRole('heading', { name: `${kimberley.length} places` })
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Where' })).toHaveValue('National Park');
  });

  it('opens a place from a filtered search, checks its dates, hands off to a watch and comes back', async () => {
    const stay = 'arrival=2099-01-10&departure=2099-01-12&adults=2';
    const { user, mock } = renderWithApp({ route: `/?${stay}`, api: placeApi() });
    const results = await screen.findByRole('region', { name: 'Results' });
    await within(results).findByRole('heading', { name: /^169 places · \d+ available/ });

    // A search and a region filter.
    await user.type(screen.getByRole('combobox', { name: 'Where' }), 'Cape{Enter}');
    await user.click(screen.getByRole('button', { name: /^Region/ }));
    const region = screen.getByRole('dialog', { name: 'Region' });
    await user.click(within(region).getByRole('checkbox', { name: /^Pilbara,/ }));
    await user.click(within(region).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(currentRoute()).toBe(`/?q=Cape&regions=Pilbara&${stay}`));
    const explore = currentRoute();

    // The card opens the place with the stay.
    await user.click(await within(results).findByRole('link', { name: 'Bungarra' }));
    const title = await screen.findByRole('heading', { level: 1, name: 'Bungarra' });
    expect(currentRoute()).toBe(`/places/parkstay/20?${stay}`);
    await waitFor(() => expect(title).toHaveFocus());

    // Check the dates.
    const card = screen.getByRole('region', { name: 'Check your dates' });
    await user.click(within(card).getByRole('button', { name: 'Check availability' }));
    const availability = await screen.findByRole('region', { name: 'Availability' });
    expect(
      await within(availability).findByText('8 of 24 sites free for all 2 nights')
    ).toBeInTheDocument();
    expect(mock?.api.catalog.checkLocation).toHaveBeenCalledTimes(1);

    // Hand off to a watch: the new watch flow opens on Your stay, with the place, dates and
    // guests from the place page (U1).
    await user.click(within(card).getByRole('link', { name: 'Watch for availability' }));
    expect(currentRoute()).toBe(
      '/watches/new?provider=parkstay&location=20&arrival=2099-01-10&departure=2099-01-12&adults=2'
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'New watch' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Step 3 of 5: Your stay' })
    ).toBeInTheDocument();
    const steps = screen.getByRole('navigation', { name: 'New watch steps' });
    expect(within(steps).getByRole('button', { name: 'Provider, done' })).toBeInTheDocument();
    expect(within(steps).getByRole('button', { name: 'Location, done' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dates Sat 10 – Mon 12 Jan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Guests 2 adults/ })).toBeInTheDocument();
    expect(screen.queryByText("Some of the link couldn't be used")).toBeNull();
    await user.click(within(steps).getByRole('button', { name: 'Location, done' }));
    expect(await screen.findByRole('combobox', { name: 'Location' })).toHaveValue('Bungarra');

    // Back to the place, then back to Explore as it was left.
    act(() => window.history.back());
    await screen.findByRole('heading', { level: 1, name: 'Bungarra' });
    await user.click(within(screen.getByRole('main')).getByRole('link', { name: 'Explore' }));
    await screen.findByRole('heading', { level: 1, name: 'Explore places to stay' });
    expect(currentRoute()).toBe(explore);
    expect(screen.getByRole('combobox', { name: 'Where' })).toHaveValue('Cape');
    expect(screen.getByRole('button', { name: 'Region, 1 selected' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Results' })).getByRole('link', {
        name: 'Bungarra',
      })
    ).toBeInTheDocument();
  });

  it('sets dates, shows availability, narrows to "Available only" and opens a place with the stay', async () => {
    const { user, mock } = renderWithApp({ route: '/', api: placeApi() });
    const results = await screen.findByRole('region', { name: 'Results' });
    await within(results).findByRole('heading', { name: '169 places' });

    // Dates from the search pill: tomorrow, for 2 nights (in Perth).
    await user.click(screen.getByRole('button', { name: /^When/ }));
    await user.keyboard('{ArrowRight}{Enter}{ArrowRight}{ArrowRight}{Enter}');
    await user.keyboard('{Escape}');
    const arrival = addDays(todayIn('Australia/Perth'), 1);
    const departure = addDays(arrival, 2);
    const stay = `arrival=${arrival}&departure=${departure}`;
    expect(currentRoute()).toBe(`/?${stay}`);

    // One bulk call for ParkStay, then every card says how it stands.
    const available = bulkAvailabilityFor().filter((e) => e.availableUnits > 0);
    const range = stayRangeLabel(arrival, departure);
    expect(
      await within(results).findByRole('heading', {
        name: `169 places · ${available.length} available for ${range}`,
      })
    ).toBeInTheDocument();
    expect(mock?.api.catalog.availability).toHaveBeenCalledTimes(1);
    expect(mock?.api.catalog.availability).toHaveBeenCalledWith(
      { arrival, departure, adults: 1, children: 0, infants: 0 },
      { providerIds: ['parkstay'] }
    );
    const [first] = within(results).getAllByRole('link');
    expect(first).toHaveAccessibleDescription(/\d+ of \d+ sites available/);

    // Available only.
    await user.click(screen.getByRole('button', { name: 'Available only' }));
    expect(currentRoute()).toBe(`/?${stay}&avail=1`);
    const cards = within(results).getAllByRole('link');
    expect(cards).toHaveLength(40);
    for (const card of cards) {
      expect(card).toHaveAccessibleDescription(/\d+ of \d+ sites available/);
    }

    // Find Bungarra (3 of its 5 sites free) and open it: its page has the same stay.
    await user.type(screen.getByRole('combobox', { name: 'Where' }), 'Bungarra{Enter}');
    const bungarra = await within(results).findByRole('link', { name: 'Bungarra' });
    expect(within(bungarra).getByText('3 of 5 sites available')).toBeInTheDocument();
    await user.click(bungarra);
    await screen.findByRole('heading', { level: 1, name: 'Bungarra' });
    expect(currentRoute()).toBe(`/places/parkstay/20?${stay}`);
    const card = screen.getByRole('region', { name: 'Check your dates' });
    expect(within(card).getByRole('button', { name: /^Dates/ })).toHaveAccessibleName(
      `Dates ${shortRange(arrival, departure)}`
    );
    // Opening the place asked ParkStay nothing more.
    expect(mock?.api.catalog.availability).toHaveBeenCalledTimes(1);
  });

  it('keeps only 40 cards on the page with 5,000 places, and still searches as you type', async () => {
    const { user, mock } = renderWithApp({ api: catalogApi({ items: SYNTHETIC_LOCATIONS_5K }) });
    const results = await screen.findByRole('region', { name: 'Results' });
    expect(
      await within(results).findByRole('heading', { name: '5000 places' })
    ).toBeInTheDocument();
    expect(within(results).getAllByRole('link')).toHaveLength(40);

    await user.type(screen.getByRole('combobox', { name: 'Where' }), 'Gorge');
    await waitFor(() =>
      expect(mock?.api.catalog.search).toHaveBeenCalledWith({ text: 'Gorge', limit: 5000 })
    );
    await waitFor(() =>
      expect(within(results).getByRole('heading', { level: 2 })).not.toHaveTextContent('5000')
    );
    expect(within(results).getAllByRole('link').length).toBeLessThanOrEqual(40);
  });
});
