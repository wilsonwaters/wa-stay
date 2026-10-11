import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { availabilityFor } from '../../../tests/fixtures/catalog/place-detail';
import { compileStylesheet } from '../../../tests/utils/tailwind';
import type { UnitSummary } from '../../shared/types/catalog.types';
import type { UnitAvailability } from '../../shared/types/provider.types';
import { NightGrid } from './NightGrid';

const SITE = { one: 'site', many: 'sites' };
const STAY = { arrival: '2026-11-06', departure: '2026-11-08', adults: 2 };

function renderGrid(shape = {}, stay = STAY) {
  const { units } = availabilityFor(stay, shape);
  return renderUnits(units, stay);
}

function renderUnits(units: UnitAvailability[], stay = STAY) {
  return render(
    <NightGrid
      units={units}
      arrival={stay.arrival}
      departure={stay.departure}
      unitNoun={SITE}
      source="ParkStay"
    />
  );
}

/** Pretends every element is `scrollWidth` wide inside `clientWidth`, for the overflow check. */
function setWidths(scrollWidth: number, clientWidth: number) {
  jest.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth);
  jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth);
}

afterEach(() => jest.restoreAllMocks());

const rowNames = () =>
  within(screen.getByRole('table'))
    .getAllByRole('rowheader')
    .map((cell) => cell.textContent);

describe('NightGrid', () => {
  it('is a real table: a caption, a column per night (never check-out) and a row per site', () => {
    renderGrid({ fully: 3 });
    const table = screen.getByRole('table', { name: 'Availability by night, 6–8 Nov' });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Site', 'Fri 6 Nov', 'Sat 7']);
    expect(headers.every((h) => h.getAttribute('scope') === 'col')).toBe(true);
    const rows = within(table).getAllByRole('rowheader');
    expect(rows).toHaveLength(3);
    expect(rows.every((h) => h.getAttribute('scope') === 'row')).toBe(true);
    // A table that fits is no tab stop.
    expect(
      screen.getByRole('region', { name: 'Availability by night, 6–8 Nov' })
    ).not.toHaveAttribute('tabindex');
  });

  it('is a tab stop while it overflows, so it can be scrolled sideways from the keyboard', () => {
    setWidths(1800, 640);
    renderGrid({ fully: 3 }, { arrival: '2026-11-06', departure: '2026-12-06', adults: 2 });
    expect(screen.getByRole('region', { name: /^Availability by night/ })).toHaveAttribute(
      'tabindex',
      '0'
    );
  });

  it("says each cell's state in words, with the price per night", () => {
    renderGrid({ fully: 1, partly: 1, rest: 'booked', price: 30 });
    const row = (name: string) =>
      screen.getByRole('rowheader', { name: new RegExp(`^${name}`) }).closest('tr')!;
    expect(
      within(row('Site 01'))
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual(['$30Available, $30', '$30Available, $30']);
    // Only fully available sites show by default; the cells of a partly free one say so.
    expect(screen.queryByRole('rowheader', { name: /Site 02/ })).not.toBeInTheDocument();
  });

  it('summarises the stay, and the switch shows partly available sites too', async () => {
    const user = userEvent.setup();
    renderGrid({ fully: 8, partly: 4 });
    expect(screen.getByText('8 of 24 sites free for all 2 nights')).toBeInTheDocument();
    const fullyOnly = screen.getByRole('switch', { name: 'Fully available only' });
    expect(fullyOnly).toBeChecked();
    expect(rowNames()).toHaveLength(8);

    await user.click(fullyOnly);
    expect(fullyOnly).not.toBeChecked();
    // The first 10 of all 24, partly available Site 09 among them.
    expect(rowNames()).toHaveLength(10);
    const partly = screen.getByRole('rowheader', { name: /Site 09/ }).closest('tr')!;
    expect(
      within(partly)
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual(['$30Available, $30', 'Booked']);
  });

  it('can start with "Fully available only" off, listing partly available sites at once', () => {
    const { units } = availabilityFor(STAY, { fully: 0, partly: 2 });
    render(
      <NightGrid
        units={units}
        arrival={STAY.arrival}
        departure={STAY.departure}
        unitNoun={SITE}
        source="ParkStay"
        fullyAvailableOnly={false}
      />
    );
    expect(screen.getByRole('switch', { name: 'Fully available only' })).not.toBeChecked();
    expect(rowNames()).toHaveLength(10);
  });

  it('follows a new "fullyAvailableOnly", such as a later result', () => {
    const { units } = availabilityFor(STAY, { fully: 1, partly: 2 });
    const grid = (fullyAvailableOnly: boolean) => (
      <NightGrid
        units={units}
        arrival={STAY.arrival}
        departure={STAY.departure}
        unitNoun={SITE}
        source="ParkStay"
        fullyAvailableOnly={fullyAvailableOnly}
      />
    );
    const { rerender } = render(grid(false));
    const toggle = () => screen.getByRole('switch', { name: 'Fully available only' });
    expect(toggle()).not.toBeChecked();
    expect(rowNames()).toHaveLength(10);
    rerender(grid(true));
    expect(toggle()).toBeChecked();
    expect(rowNames()).toHaveLength(1);
    rerender(grid(false));
    expect(toggle()).not.toBeChecked();
  });

  it('shows the first 10 rows, then all of them', async () => {
    const user = userEvent.setup();
    renderGrid({ fully: 14 });
    expect(rowNames()).toHaveLength(10);
    const more = screen.getByRole('button', { name: 'Show all 14 sites' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(rowNames()).toHaveLength(14);
    expect(more).toHaveTextContent('Show fewer sites');
    expect(more).toHaveFocus();
  });

  it('says why "Fully available only" shows nothing', () => {
    renderGrid({ fully: 0, partly: 2 });
    expect(screen.getByText('0 of 24 sites free for all 2 nights')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(/Turn off "Fully available only"/)).toBeInTheDocument();
  });

  it('says nights not released yet are not released, never that sites are taken', async () => {
    const user = userEvent.setup();
    renderGrid({ fully: 0, partly: 0, rest: 'not-released' });
    expect(screen.getByText("These nights aren't released for booking yet")).toBeInTheDocument();
    expect(screen.queryByText(/No sites are free/)).toBeNull();
    await user.click(screen.getByRole('switch', { name: 'Fully available only' }));
    const row = screen.getByRole('rowheader', { name: /^Site 01/ }).closest('tr')!;
    expect(within(row).getAllByRole('cell')[0]).toHaveTextContent('Not released yet');
  });

  it("says the provider didn't say when no night is known, as for a class-listed place", async () => {
    const user = userEvent.setup();
    renderUnits([
      {
        unitId: '309',
        unitName: 'One site - select on arrival',
        nights: [],
        fullyAvailable: false,
      },
    ]);
    expect(
      screen.getByText("ParkStay didn't say which nights are free; check on ParkStay")
    ).toBeInTheDocument();
    expect(screen.queryByText(/free for all|No sites are free/)).toBeNull();
    expect(
      screen.getByText('Turn off "Fully available only" to see each site\'s nights.')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Fully available only' }));
    const row = screen.getByRole('rowheader', { name: /^One site/ }).closest('tr')!;
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    ).toEqual(['Unknown', 'Unknown']);
  });

  it('words a split night (free, but on another site) as settled, in the unit noun', async () => {
    const user = userEvent.setup();
    renderUnits([
      {
        unitId: 'class:117',
        unitName: 'One site - select on arrival',
        nights: [
          { date: '2026-11-06', state: 'available', price: 20, label: '$20.00' },
          { date: '2026-11-07', state: 'unknown', reason: 'split', price: 20, label: '$20.00' },
        ],
        fullyAvailable: false,
      },
    ]);
    expect(screen.getByText('0 of 1 site free for all 2 nights')).toBeInTheDocument();
    expect(
      screen.getByText('Free on some nights, but not on one site for the whole stay.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/didn't say/)).toBeNull();
    await user.click(screen.getByRole('switch', { name: 'Fully available only' }));
    const row = screen.getByRole('rowheader', { name: /^One site/ }).closest('tr')!;
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    ).toEqual(['$20Available, $20', 'Free on another site']);
    const key = within(screen.getByRole('list', { name: 'Key' })).getAllByRole('listitem');
    expect(key.map((item) => item.textContent)).toEqual(['Available', 'Free on another site']);
  });

  it('counts only known nights, and notes the sites it leaves out', () => {
    const { units } = availabilityFor(STAY, { fully: 2, partly: 0, rest: 'booked' });
    units[2].nights = [{ date: '2026-11-06', state: 'not-released' }];
    units[3].nights = [];
    renderUnits(units.slice(0, 4));
    expect(screen.getByText('2 of 2 sites free for all 2 nights')).toBeInTheDocument();
    expect(
      screen.getByText("1 more site has nights that aren't released yet.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("ParkStay didn't say which nights are free for 1 more site.")
    ).toBeInTheDocument();
  });

  it('keeps a long stay to one column per night, scrolling sideways', async () => {
    const user = userEvent.setup();
    const long = { arrival: '2026-11-06', departure: '2026-12-06', adults: 2 };
    renderGrid({ fully: 2 }, long);
    expect(screen.getAllByRole('columnheader')).toHaveLength(31);
    expect(screen.getByRole('columnheader', { name: 'Tue 1 Dec' })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Fully available only' }));
    expect(screen.getByText('2 of 24 sites free for all 30 nights')).toBeInTheDocument();
  });

  it('has a key to the icons, for the states on screen', async () => {
    const user = userEvent.setup();
    renderGrid({ fully: 2, rest: 'closed' });
    const key = () => within(screen.getByRole('list', { name: 'Key' })).getAllByRole('listitem');
    expect(key().map((item) => item.textContent)).toEqual(['Available']);
    await user.click(screen.getByRole('switch', { name: 'Fully available only' }));
    expect(key().map((item) => item.textContent)).toEqual(['Available', 'Closed']);
  });
});

describe('NightGrid layout (with the real stylesheet)', () => {
  let style: HTMLStyleElement;

  beforeAll(async () => {
    style = document.createElement('style');
    style.textContent = await compileStylesheet({ unlayered: true });
    document.head.appendChild(style);
  });
  afterAll(() => style.remove());

  /** The element that positions `el`: its nearest ancestor that is not statically positioned. */
  function containingBlock(el: Element): Element | null {
    let block = el.parentElement;
    while (block && ['', 'static'].includes(getComputedStyle(block).position)) {
      block = block.parentElement;
    }
    return block;
  }

  it("keeps every cell's hidden text inside the scrolling region, so the page never scrolls", async () => {
    const user = userEvent.setup();
    renderGrid({ fully: 4 }, { arrival: '2026-11-06', departure: '2026-12-06', adults: 2 });
    await user.click(screen.getByRole('switch', { name: 'Fully available only' }));
    const region = screen.getByRole('region', { name: /^Availability by night/ });
    const hidden = [...region.querySelectorAll('*')].filter(
      (el) => getComputedStyle(el).position === 'absolute'
    );
    // Every cell's words, and the caption.
    expect(hidden.length).toBeGreaterThan(30 * 10);
    for (const el of hidden) {
      const block = containingBlock(el);
      expect(block !== null && (block === region || region.contains(block))).toBe(true);
    }
  });

  describe('unit details', () => {
    const units = () => availabilityFor(STAY, { fully: 3 }).units;
    const details = (): ReadonlyMap<string, UnitSummary> => {
      const [first, second] = units();
      return new Map<string, UnitSummary>([
        [
          first.unitId,
          {
            unitId: first.unitId,
            unitName: first.unitName,
            minPeople: 1,
            maxPeople: 6,
            maxVehicles: 3,
            description: '12m x 7m <b>reverse-in</b> compacted gravel site.',
          },
        ],
        // Known to the place, but with nothing to add.
        [second.unitId, { unitId: second.unitId, unitName: second.unitName }],
      ]);
    };

    it('shows a unit’s people and vehicle limits and its description, in words, under its name', () => {
      const [first] = units();
      render(
        <NightGrid
          units={units()}
          arrival={STAY.arrival}
          departure={STAY.departure}
          unitNoun={SITE}
          unitDetails={details()}
        />
      );
      const heading = screen.getByRole('rowheader', { name: new RegExp(`^${first.unitName}`) });
      expect(within(heading).getByText('1–6 people')).toBeInTheDocument();
      expect(within(heading).getByText('3 vehicles')).toBeInTheDocument();
      // Plain text, never HTML.
      expect(
        within(heading).getByText('12m x 7m <b>reverse-in</b> compacted gravel site.')
      ).toBeInTheDocument();
      expect(heading.querySelector('b')).toBeNull();
      // The icons are decoration: the words carry the meaning.
      for (const icon of heading.querySelectorAll('svg')) {
        expect(icon).toHaveAttribute('aria-hidden', 'true');
      }
      expect(heading).toHaveAccessibleName(
        `${first.unitName} ${first.unitType} 1–6 people 3 vehicles 12m x 7m <b>reverse-in</b> compacted gravel site.`
      );
    });

    it('shows a unit without details, or without an entry, as before', () => {
      const [, second, third] = units();
      render(
        <NightGrid
          units={units()}
          arrival={STAY.arrival}
          departure={STAY.departure}
          unitNoun={SITE}
          unitDetails={details()}
        />
      );
      const before = renderUnits(units());
      const plain = (name: string) =>
        screen
          .getAllByRole('rowheader', { name: new RegExp(`^${name} `) })
          .map((cell) => cell.outerHTML);
      // Each name now has two rows: the grid with details, and the one without.
      for (const unit of [second, third]) {
        const [withDetails, without] = plain(unit.unitName);
        expect(withDetails).toBe(without);
      }
      before.unmount();
    });
  });
});
