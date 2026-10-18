import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_EXPLORE_PARAMS, type ExploreParams } from '../state/exploreParams';
import type { ExploreFacets } from './facets';
import { FilterRow } from './FilterRow';

const FACETS: ExploreFacets = {
  providers: [{ value: 'parkstay', label: 'ParkStay WA', count: 11 }],
  stayTypes: [
    { value: 'campsite', label: 'Camping', count: 10 },
    { value: 'cabin', label: 'Cabins & villas', count: 1 },
    { value: 'dorm', label: 'Dorms', count: 1 },
  ],
  regions: [],
  amenities: [],
  online: 7,
};

/** FilterRow with its params kept in state, as Explore keeps them in the URL. */
function Harness({ showStayTypes = true }: { showStayTypes?: boolean }) {
  const [params, setParams] = useState<ExploreParams>({ ...DEFAULT_EXPLORE_PARAMS });
  return (
    <>
      <FilterRow
        params={params}
        facets={FACETS}
        showStayTypes={showStayTypes}
        onChange={(patch) => setParams((current) => ({ ...current, ...patch }))}
        onClearAll={() => setParams({ ...DEFAULT_EXPLORE_PARAMS })}
        availableOnlyUnavailable="Add dates to filter by availability"
        onAvailableOnlyChange={() => undefined}
      />
      <output aria-label="Chosen stay types">{params.stayTypes.join(',')}</output>
    </>
  );
}

function renderRow(showStayTypes?: boolean) {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  const user = userEvent.setup();
  const view = render(<Harness showStayTypes={showStayTypes} />, { container: root });
  return { ...view, user };
}

const filters = () => screen.getByRole('group', { name: 'Filters' });
const chosen = () => screen.getByRole('status', { name: 'Chosen stay types' });

afterEach(() => {
  document.getElementById('root')?.remove();
});

describe('FilterRow: Stay type', () => {
  it('offers the stay types as checkboxes in group order, with how they combine', async () => {
    const { user } = renderRow();
    const chip = within(filters()).getByRole('button', { name: 'Stay type' });
    await user.click(chip);
    const popover = screen.getByRole('dialog', { name: 'Stay type' });
    expect(within(popover).getByRole('group', { name: 'Stay type' })).toBeInTheDocument();
    expect(
      within(popover)
        .getAllByRole('checkbox')
        .map((box) => box.getAttribute('aria-label'))
    ).toEqual(['Camping, 10 places', 'Cabins & villas, 1 place', 'Dorms, 1 place']);
    expect(within(popover).getByText('Places with any of these')).toBeInTheDocument();

    await user.click(within(popover).getByRole('checkbox', { name: 'Dorms, 1 place' }));
    await user.click(within(popover).getByRole('checkbox', { name: 'Camping, 10 places' }));
    expect(chosen()).toHaveTextContent('dorm,campsite');
    await user.click(within(popover).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Stay type' })).toBeNull();
    expect(within(filters()).getByRole('button', { name: 'Stay type, 2 selected' })).toHaveFocus();

    // "Clear all" shows while one is chosen, and clears them.
    await user.click(within(filters()).getByRole('button', { name: 'Clear all' }));
    expect(chosen()).toHaveTextContent('');
    expect(within(filters()).getByRole('button', { name: 'Stay type' })).toBeInTheDocument();
  });

  it('returns focus to the chip on Escape', async () => {
    const { user } = renderRow();
    await user.click(within(filters()).getByRole('button', { name: 'Stay type' }));
    await user.click(screen.getByRole('checkbox', { name: 'Cabins & villas, 1 place' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Stay type' })).toBeNull();
    expect(within(filters()).getByRole('button', { name: 'Stay type, 1 selected' })).toHaveFocus();
  });

  it('is left out when Explore says so, and never shows the old Type chip', () => {
    renderRow(false);
    expect(
      within(filters())
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Provider', 'Region', 'Facilities', 'Book online', 'Available only']);
  });
});
