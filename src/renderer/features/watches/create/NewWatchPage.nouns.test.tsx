import { screen, within } from '@testing-library/react';
import type { LocationDetail, UnitSummary } from '../../../../shared/types/catalog.types';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST, ok } from '@tests/utils/renderer/createMockApi';
import {
  catalogGet,
  makeLocation,
  makeLocationDetail,
  makeWatch,
} from '@tests/fixtures/renderer/watches';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

/**
 * The create-watch flow names a place's units by their kinds (R9): at a place of cabins the unit
 * choice, its disclosure and the automatic hold all say "cabin"; ParkStay's sites stay sites.
 */
const PREFILL =
  '/watches/new?provider=parkstay&location=20&arrival=2099-12-11&departure=2099-12-13&adults=2';

const cabin = (n: number): UnitSummary => ({
  unitId: `c${n}`,
  unitName: `Cabin ${n}`,
  unitType: 'Two bedroom',
  unitKind: 'cabin',
});
const CABINS = makeLocationDetail({ kind: 'cabin', units: [1, 2, 3].map(cabin) });

function api(detail: LocationDetail) {
  return {
    providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST, FAKE_MANIFEST])) },
    catalog: {
      get: catalogGet(detail),
      search: jest.fn().mockResolvedValue(ok({ items: [makeLocation()], total: 1 })),
      status: jest
        .fn()
        .mockResolvedValue(
          ok({ providers: [{ providerId: 'parkstay', count: 6, stale: false, syncing: false }] })
        ),
    },
    watches: {
      list: jest.fn().mockResolvedValue(ok([])),
      create: jest.fn().mockResolvedValue(ok(makeWatch({ id: 42 }))),
    },
    accounts: { list: jest.fn().mockResolvedValue(ok([])) },
  };
}

const button = (name: string) => screen.getByRole('button', { name });
const step = (name: RegExp) => screen.findByRole('heading', { level: 2, name });

describe('NewWatchPage: unit nouns', () => {
  it('calls a place of cabins’ units cabins: the choice, its disclosure and the hold', async () => {
    const { user } = renderWithApp({ route: PREFILL, api: api(CABINS) });
    await step(/Your stay$/);
    expect(await screen.findByText('Preferred cabins')).toBeInTheDocument();
    expect(screen.getByText(/^Any cabin\./)).toBeInTheDocument();
    await user.click(button('Choose cabins'));
    const all = screen.getByRole('checkbox', { name: 'All Two bedroom (3)' });
    expect(all).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Cabin 2' }));
    expect(screen.getByText(/^1 cabin chosen\./)).toBeInTheDocument();

    await user.click(button('Continue'));
    await step(/Alerts$/);
    const hold = screen.getByRole('checkbox', { name: 'Hold a cabin automatically when found' });
    expect(hold).toHaveAccessibleDescription(
      expect.stringContaining('When a cabin is free for your whole stay')
    );
  });

  it('keeps ParkStay’s sites: "Preferred sites", "Choose sites", "Hold a site"', async () => {
    const { user } = renderWithApp({ route: PREFILL, api: api(makeLocationDetail()) });
    await step(/Your stay$/);
    expect(await screen.findByText('Preferred sites')).toBeInTheDocument();
    await user.click(button('Choose sites'));
    expect(
      within(screen.getByRole('group', { name: 'Powered' })).getByRole('checkbox', {
        name: 'All Powered (4)',
      })
    ).toBeInTheDocument();
    await user.click(button('Continue'));
    await step(/Alerts$/);
    expect(
      screen.getByRole('checkbox', { name: 'Hold a site automatically when found' })
    ).toBeInTheDocument();
  });
});
