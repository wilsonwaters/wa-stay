import { screen } from '@testing-library/react';
import type { LocationDetail } from '../../../../shared/types/catalog.types';
import { SNIPE_PREFILL, snipeFlowApi } from '@tests/fixtures/renderer/snipes';
import { catalogGet, makeLocationDetail } from '@tests/fixtures/renderer/watches';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

/** Osprey Bay with sites taking at least `minNights` (`count` of them; the rest none). */
function withMinimums(minNights: number, count = 6): LocationDetail {
  const detail = makeLocationDetail();
  return {
    ...detail,
    units: detail.units.map((unit, i) => (i < count ? { ...unit, minNights } : unit)),
  };
}

const api = (detail: LocationDetail) => snipeFlowApi({ catalog: { get: catalogGet(detail) } });
const warning = () =>
  screen.queryAllByRole('status').find((status) => /need at least/.test(status.textContent ?? ''));

describe('NewSnipePage: a stay shorter than the units take', () => {
  it('warns that the place’s sites need more nights than the 2-night stay: a snipe holds only what ParkStay accepts', async () => {
    const { user } = renderWithApp({ route: SNIPE_PREFILL, api: api(withMinimums(3)) });
    await screen.findByText('Preferred sites');
    expect(warning()).toHaveTextContent(
      "Osprey Bay's sites need at least 3 nights. WA Stay only holds stays ParkStay accepts."
    );
    // It does not stop the snipe
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: /Release and timing$/ })
    ).toBeInTheDocument();
  });

  it('says "Some" when only some sites need more, and nothing where none has a minimum', async () => {
    const { unmount } = renderWithApp({ route: SNIPE_PREFILL, api: api(withMinimums(4, 2)) });
    await screen.findByText('Preferred sites');
    expect(warning()).toHaveTextContent('Some sites need at least 4 nights.');
    unmount();
    renderWithApp({ route: SNIPE_PREFILL, api: api(makeLocationDetail()) });
    await screen.findByText('Preferred sites');
    expect(warning()).toBeUndefined();
  });
});
