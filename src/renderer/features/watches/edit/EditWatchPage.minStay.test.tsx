import { screen } from '@testing-library/react';
import type { LocationDetail } from '../../../../shared/types/catalog.types';
import type { Watch } from '../../../../shared/types/watch.types';
import { PARKSTAY_MANIFEST, ok } from '@tests/utils/renderer/createMockApi';
import { catalogGet, makeLocationDetail, makeWatch } from '@tests/fixtures/renderer/watches';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

function api(watch: Watch, detail: LocationDetail) {
  return {
    providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST])) },
    catalog: {
      get: catalogGet(detail),
      search: jest.fn().mockResolvedValue(ok({ items: [], total: 0 })),
      status: jest
        .fn()
        .mockResolvedValue(
          ok({ providers: [{ providerId: 'parkstay', count: 6, stale: false, syncing: false }] })
        ),
    },
    watches: {
      get: jest.fn().mockResolvedValue(ok(watch)),
      list: jest.fn().mockResolvedValue(ok([])),
      update: jest.fn().mockResolvedValue(ok(watch)),
    },
    accounts: { list: jest.fn().mockResolvedValue(ok([])) },
  };
}

/** Osprey Bay with every site taking at least 3 nights. */
function withMinimums(minNights = 3): LocationDetail {
  const detail = makeLocationDetail();
  return { ...detail, units: detail.units.map((unit) => ({ ...unit, minNights })) };
}

const warning = () =>
  screen.queryAllByRole('status').find((status) => /need at least/.test(status.textContent ?? ''));

describe('EditWatchPage: a stay shorter than the units take', () => {
  it('warns that every site of the place needs 3 nights for the stored 2-night stay', async () => {
    renderWithApp({ route: '/watches/5/edit', api: api(makeWatch({ id: 5 }), withMinimums()) });
    await screen.findByText('Preferred sites');
    expect(warning()).toHaveTextContent(
      "Osprey Bay's sites need at least 3 nights. WA Stay only alerts on stays ParkStay accepts."
    );
  });

  it('warns about none for a stay that is long enough, or units with no minimum', async () => {
    const long = makeWatch({
      id: 5,
      stay: { ...makeWatch().stay, arrival: '2099-12-11', departure: '2099-12-14' },
    });
    const { unmount } = renderWithApp({ route: '/watches/5/edit', api: api(long, withMinimums()) });
    await screen.findByText('Preferred sites');
    expect(warning()).toBeUndefined();
    unmount();
    renderWithApp({
      route: '/watches/5/edit',
      api: api(makeWatch({ id: 5 }), makeLocationDetail()),
    });
    await screen.findByText('Preferred sites');
    expect(warning()).toBeUndefined();
  });
});
