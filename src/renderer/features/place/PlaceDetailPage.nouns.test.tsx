/**
 * A place's page names its units by their kinds (R9): a place of cabins has a "Cabins" section,
 * "2 of 5 cabins free…" and "Snipe a cabin"; a place of sites and cabins says "spots".
 */
import { configure, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { availabilityFor, placeDetail } from '../../../../tests/fixtures/catalog/place-detail';
import { placeApi } from '../../../../tests/utils/renderer/catalog';
import { renderWithApp } from '../../../../tests/utils/renderer/renderWithApp';
import type { UnitSummary } from '../../../shared/types/catalog.types';
import type { UnitKind } from '../../../shared/types/provider.types';

configure({ asyncUtilTimeout: 4000 });

const STAY = '?arrival=2099-11-06&departure=2099-11-08&adults=2';
const units = (kinds: UnitKind[]): UnitSummary[] =>
  kinds.map((unitKind, i) => ({ unitId: String(i + 1), unitName: `Unit ${i + 1}`, unitKind }));

async function renderPlace(placeUnits: UnitSummary[]) {
  const detail = placeDetail({ units: placeUnits, unitCount: placeUnits.length });
  const api = placeApi({ detail });
  api.catalog.checkLocation = jest.fn(async (_key: string, stay) => ({
    success: true,
    data: availabilityFor(stay, { fully: 2, partly: 1 }, placeUnits),
  }));
  const view = renderWithApp({ route: `/places/parkstay/20${STAY}`, api });
  await screen.findByRole('heading', { level: 2, name: 'About' });
  return view;
}

const card = () => screen.getByRole('region', { name: 'Check your dates' });

describe('PlaceDetailPage: unit nouns', () => {
  it('a place of cabins: its section, its count, the check and "Snipe a cabin"', async () => {
    await renderPlace(units(['cabin', 'cabin', 'cabin', 'cabin', 'cabin']));
    const section = await screen.findByRole('region', { name: 'Cabins' });
    expect(within(section).getByText('5 cabins')).toBeInTheDocument();
    expect(
      within(card()).getByRole('link', { name: 'Snipe a cabin, coming soon' })
    ).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(card()).getByRole('button', { name: 'Check availability' }));
    const availability = await screen.findByRole('region', { name: 'Availability' });
    expect(
      await within(availability).findByText('2 of 5 cabins free for all 2 nights')
    ).toBeInTheDocument();
  });

  it('a place whose units are types (RAC): "Bookable as 6 spot types", never "6 spots" beside "51 spots free"', async () => {
    const types: UnitSummary[] = [
      ['cat:9', 'Two Bedroom Cabin', 'cabin', 'Cabins'],
      ['cat:3', 'Studio Room', 'cabin', 'Cabins'],
      ['cat:7', 'Ensuite Site', 'campsite', 'Sites'],
      ['cat:20', 'Powered Big Rig Site', 'campsite', 'Sites'],
      ['cat:4', 'Powered Site', 'campsite', 'Sites'],
      ['cat:5', 'Unpowered Site', 'campsite', 'Sites'],
    ].map(([unitId, unitName, unitKind, unitType]) => ({
      unitId,
      unitName,
      unitKind: unitKind as UnitKind,
      unitType,
    }));
    const detail = placeDetail({ units: types, unitCount: undefined, unitsAreTypes: true });
    const api = placeApi({ detail });
    api.catalog.checkLocation = jest.fn(async (_key: string, stay) => {
      const availability = availabilityFor(stay, { fully: 0, partly: 0 }, types);
      // Only the powered sites are free for the stay: 51 of them, RAC's whole-stay count
      availability.units = availability.units.map((unit) =>
        unit.unitId === 'cat:4'
          ? {
              ...unit,
              nights: unit.nights.map((night) => ({ ...night, state: 'available' as const })),
              fullyAvailable: true,
              freeCount: 51,
            }
          : { ...unit, freeCount: 0 }
      );
      return { success: true, data: availability };
    });
    renderWithApp({ route: `/places/parkstay/20${STAY}`, api });
    await screen.findByRole('heading', { level: 2, name: 'About' });

    const section = await screen.findByRole('region', { name: 'Spots' });
    expect(within(section).getByText('Bookable as 6 spot types')).toBeInTheDocument();
    expect(within(section).queryByText(/^\d+ spots?$/)).toBeNull();
    expect(within(section).getByText('Cabins: 2 types')).toBeInTheDocument();
    expect(within(section).getByText('Sites: 4 types')).toBeInTheDocument();
    expect(within(section).queryByText(/×/)).toBeNull();
    expect(
      within(section).getByRole('button', { name: 'Show all 6 spot types' })
    ).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(card()).getByRole('button', { name: 'Check availability' }));
    const availability = await screen.findByRole('region', { name: 'Availability' });
    expect(
      await within(availability).findByText('51 spots free for all 2 nights')
    ).toBeInTheDocument();
  });

  it('a place of sites and cabins: "spots"', async () => {
    await renderPlace(units(['campsite', 'campsite', 'cabin']));
    const section = await screen.findByRole('region', { name: 'Spots' });
    expect(within(section).getByText('3 spots')).toBeInTheDocument();
    expect(
      within(card()).getByRole('link', { name: 'Snipe a spot, coming soon' })
    ).toBeInTheDocument();
  });
});
