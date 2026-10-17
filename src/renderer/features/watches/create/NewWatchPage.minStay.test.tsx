import { screen } from '@testing-library/react';
import type { LocationDetail } from '../../../../shared/types/catalog.types';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST, ok } from '@tests/utils/renderer/createMockApi';
import {
  catalogGet,
  makeLocation,
  makeLocationDetail,
  makeWatch,
} from '@tests/fixtures/renderer/watches';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

/** A 2-night stay at Osprey Bay, 11–13 Dec. */
const PREFILL =
  '/watches/new?provider=parkstay&location=20&arrival=2099-12-11&departure=2099-12-13&adults=2';

/** Osprey Bay with sites 1–4 taking at least 3 nights (5 and 6 have no minimum). */
function withMinimums(): LocationDetail {
  const detail = makeLocationDetail();
  return {
    ...detail,
    units: detail.units.map((unit, i) => (i < 4 ? { ...unit, minNights: 3 } : unit)),
  };
}

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
      get: jest.fn().mockResolvedValue(ok(makeWatch({ id: 42 }))),
    },
  };
}

const button = (name: string) => screen.getByRole('button', { name });
/** The stay step's minimum-stay warning: a status, by its words. */
const warning = () =>
  screen.queryAllByRole('status').find((status) => /need at least/.test(status.textContent ?? ''));
const EVERY =
  "Osprey Bay's sites need at least 3 nights. WA Stay only alerts on stays ParkStay accepts.";

describe('NewWatchPage: a stay shorter than the units take', () => {
  it('warns about some sites, then the chosen ones, and not once a site with no minimum is chosen', async () => {
    const { user } = renderWithApp({ route: PREFILL, api: api(withMinimums()) });
    await screen.findByRole('heading', { level: 2, name: /Your stay$/ });
    await screen.findByText('Preferred sites');
    expect(warning()).toHaveTextContent('Some sites need at least 3 nights.');

    await user.click(button('Choose sites'));
    await user.click(screen.getByRole('checkbox', { name: 'Site 1' }));
    expect(warning()).toHaveTextContent(EVERY);

    await user.click(screen.getByRole('checkbox', { name: 'Site 1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Site 5' }));
    expect(warning()).toBeUndefined();
  });

  it('warns about none where the units have no minimum, as on ParkStay', async () => {
    renderWithApp({ route: PREFILL, api: api(makeLocationDetail()) });
    await screen.findByText('Preferred sites');
    expect(warning()).toBeUndefined();
    expect(screen.queryByText(/need at least/)).toBeNull();
  });
});
