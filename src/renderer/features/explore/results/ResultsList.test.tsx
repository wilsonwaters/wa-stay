import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router';
import { PARKSTAY_LOCATIONS } from '../../../../../tests/fixtures/catalog/parkstay-locations';
import { ProviderManifestsProvider } from '../../../components/ui';
import { createHighlightStore, HighlightContext } from '../state/highlight';
import { ResultsList, type ResultsListProps } from './ResultsList';

// Count each card's renders, by location key, around the real LocationCard.
const renders = new Map<string, number>();
jest.mock('../../../components/LocationCard', () => {
  const actual = jest.requireActual('../../../components/LocationCard');
  const { createElement: h } = jest.requireActual('react');
  return {
    ...actual,
    LocationCard: (props: { location: { key: string } }) => {
      renders.set(props.location.key, (renders.get(props.location.key) ?? 0) + 1);
      return h(actual.LocationCard, props);
    },
  };
});

const PLACES = PARKSTAY_LOCATIONS.slice(0, 10);

function renderList(props: Partial<ResultsListProps> = {}) {
  const store = createHighlightStore();
  const view = render(
    <MemoryRouter>
      <ProviderManifestsProvider manifests={[]}>
        <HighlightContext.Provider value={store}>
          {createElement(ResultsList, {
            state: { kind: 'results' },
            items: PLACES,
            inMapArea: false,
            width: 'split',
            selectedKey: null,
            resetKey: 'all',
            onHighlight: store.set,
            onRetry: jest.fn(),
            onClearFilters: jest.fn(),
            onShowAll: jest.fn(),
            ...props,
          })}
        </HighlightContext.Provider>
      </ProviderManifestsProvider>
    </MemoryRouter>
  );
  return { ...view, store };
}

const counts = () => PLACES.map((p) => renders.get(p.key) ?? 0);

beforeEach(() => renders.clear());

describe('ResultsList', () => {
  it('re-renders only the cards whose highlight changes when hover moves', async () => {
    const user = userEvent.setup();
    const { store } = renderList();
    expect(counts()).toEqual(Array(10).fill(1));

    await user.hover(screen.getByRole('link', { name: PLACES[3].name }));
    expect(store.get()).toBe(PLACES[3].key);
    expect(counts()).toEqual([1, 1, 1, 2, 1, 1, 1, 1, 1, 1]);

    // A pin hovered on the map: the previous card and the new one, nothing else.
    act(() => store.set(PLACES[7].key));
    expect(counts()).toEqual([1, 1, 1, 3, 1, 1, 1, 2, 1, 1]);
  });

  it('re-renders only the old and new selected cards when the selection changes', () => {
    const { rerender, store } = renderList({ selectedKey: PLACES[1].key });
    renders.clear();
    rerender(
      <MemoryRouter>
        <ProviderManifestsProvider manifests={[]}>
          <HighlightContext.Provider value={store}>
            <ResultsList
              state={{ kind: 'results' }}
              items={PLACES}
              inMapArea={false}
              width="split"
              selectedKey={PLACES[2].key}
              resetKey="all"
              onHighlight={store.set}
              onRetry={jest.fn()}
              onClearFilters={jest.fn()}
              onShowAll={jest.fn()}
            />
          </HighlightContext.Provider>
        </ProviderManifestsProvider>
      </MemoryRouter>
    );
    expect(counts()).toEqual([0, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('names the heading by count, saying when it is the map area', () => {
    renderList({ items: PLACES.slice(0, 1), inMapArea: true });
    expect(
      screen.getByRole('heading', { level: 2, name: '1 place in map area' })
    ).toBeInTheDocument();
  });

  it('renders cards for a selected place beyond the first 40', () => {
    const many = PARKSTAY_LOCATIONS.slice(0, 100);
    renderList({ items: many, selectedKey: many[85].key });
    expect(screen.getByRole('link', { name: many[85].name })).toHaveAttribute(
      'aria-current',
      'true'
    );
    // Three pages of 40 hold the 86th place: all 100 here.
    expect(screen.getAllByRole('listitem')).toHaveLength(100);
  });
});
