/**
 * A place's notices row (PD4): warnings first, the first few shown and the rest behind
 * "Show all {n} notices".
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LocationNotice, LocationNoticeLevel } from '../../../shared/types/catalog.types';
import { NOTICES_SHOWN, PlaceNotices } from './PlaceSections';

/** Bungarra's 11 notices, in the order ParkStay's campground page gives them. */
const BUNGARRA: LocationNotice[] = [
  { level: 'warning', text: 'Drinking water not supplied: bring your own' },
  { level: 'warning', text: 'No dump point: carry portable toilet waste out' },
  { level: 'warning', text: 'No campfires at any time' },
  { level: 'warning', text: 'No dogs or other domestic animals' },
  { level: 'warning', text: 'No generators' },
  { level: 'caution', text: 'No-flush pit toilets only' },
  { level: 'caution', text: 'SEASONAL CLOSURE FROM 1 NOVEMBER 2026, REOPENING ON 15 MARCH 2027' },
  { level: 'info', text: 'Book now for stays to 30 April 2027' },
  { level: 'info', text: 'Bookings for May 2027 open 10AM AWST Tuesday 3 November 2026' },
  { level: 'info', text: "Additional per-vehicle entry fee shown after 'Book now'" },
  { level: 'info', text: "To pay entry fee separately: deselect 'Pay park entry' at next screen" },
];

/** `count` notices of one level, "Notice 1"… */
function notices(count: number, level: LocationNoticeLevel = 'info'): LocationNotice[] {
  return Array.from({ length: count }, (_, i) => ({ level, text: `Notice ${i + 1}` }));
}

function renderNotices(list: readonly LocationNotice[]) {
  const user = userEvent.setup();
  const view = render(<PlaceNotices notices={list} shortName="ParkStay" />);
  return { ...view, user };
}

const list = () => screen.getByRole('list', { name: 'Notices from ParkStay' });
const shown = () =>
  within(list())
    .getAllByRole('listitem')
    .map((item) => item.textContent);

describe('PlaceNotices', () => {
  it('sorts before it collapses: a warning listed last is among the notices shown', () => {
    renderNotices([...notices(NOTICES_SHOWN), { level: 'warning', text: 'No campfires' }]);
    expect(shown()).toHaveLength(NOTICES_SHOWN);
    expect(shown()[0]).toBe('Warning: No campfires');
    expect(
      screen.getByRole('button', { name: `Show all ${NOTICES_SHOWN + 1} notices` })
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows warnings, then cautions, then information, in the provider’s order within each', async () => {
    const { user } = renderNotices([
      { level: 'info', text: 'Book now for stays to 30 April 2027' },
      { level: 'caution', text: 'No-flush pit toilets only' },
      { level: 'warning', text: 'No campfires at any time' },
      { level: 'info', text: "Additional per-vehicle entry fee shown after 'Book now'" },
      // A level the app does not know shows as information, and sorts with it.
      { level: 'notice' as LocationNoticeLevel, text: 'Gates close at dusk' },
      { level: 'warning', text: 'No dogs or other domestic animals' },
      { level: 'caution', text: 'SEASONAL CLOSURE FROM 1 NOVEMBER 2026' },
    ]);
    await user.click(screen.getByRole('button', { name: 'Show all 7 notices' }));
    expect(shown()).toEqual([
      'Warning: No campfires at any time',
      'Warning: No dogs or other domestic animals',
      'Caution: No-flush pit toilets only',
      'Caution: SEASONAL CLOSURE FROM 1 NOVEMBER 2026',
      'Information: Book now for stays to 30 April 2027',
      "Information: Additional per-vehicle entry fee shown after 'Book now'",
      'Information: Gates close at dusk',
    ]);
  });

  it('orders a short list too', () => {
    renderNotices([
      { level: 'info', text: 'Book now for stays to 30 April 2027' },
      { level: 'caution', text: 'No-flush pit toilets only' },
      { level: 'warning', text: 'No campfires at any time' },
    ]);
    expect(shown()).toEqual([
      'Warning: No campfires at any time',
      'Caution: No-flush pit toilets only',
      'Information: Book now for stays to 30 April 2027',
    ]);
  });

  it(`shows the first ${NOTICES_SHOWN} of Bungarra's 11, with "Show all 11 notices" under them`, () => {
    renderNotices(BUNGARRA);
    expect(NOTICES_SHOWN).toBe(3);
    expect(shown()).toEqual([
      'Warning: Drinking water not supplied: bring your own',
      'Warning: No dump point: carry portable toilet waste out',
      'Warning: No campfires at any time',
    ]);
    const toggle = screen.getByRole('button', { name: 'Show all 11 notices' });
    expect(list().compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Each shown notice keeps its level's icon, hidden from screen readers.
    for (const item of within(list()).getAllByRole('listitem')) {
      expect(item.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('opens and closes on a click: its name, aria-expanded and aria-controls, focus kept', async () => {
    const { user } = renderNotices(BUNGARRA);
    const toggle = screen.getByRole('button', { name: 'Show all 11 notices' });
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', list().id);
    expect(list().id).not.toBe('');

    await user.click(toggle);
    expect(toggle).toHaveAccessibleName('Show fewer notices');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', list().id);
    expect(toggle).toHaveFocus();
    expect(shown()).toEqual(
      BUNGARRA.map(
        (notice) =>
          `${{ warning: 'Warning', caution: 'Caution', info: 'Information' }[notice.level]}: ${notice.text}`
      )
    );

    await user.click(toggle);
    expect(toggle).toHaveAccessibleName('Show all 11 notices');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
    expect(shown()).toHaveLength(NOTICES_SHOWN);
  });

  it('toggles with Enter and Space, keeping focus on the button', async () => {
    const { user } = renderNotices(BUNGARRA);
    await user.tab();
    const toggle = screen.getByRole('button', { name: 'Show all 11 notices' });
    expect(toggle).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName('Show fewer notices');
    expect(toggle).toHaveFocus();
    expect(shown()).toHaveLength(11);

    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAccessibleName('Show all 11 notices');
    expect(toggle).toHaveFocus();
    expect(shown()).toHaveLength(NOTICES_SHOWN);

    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveFocus();
  });

  it(`has no toggle at or under ${NOTICES_SHOWN} notices, and one from ${NOTICES_SHOWN + 1}`, () => {
    for (const count of [1, NOTICES_SHOWN - 1, NOTICES_SHOWN]) {
      const { unmount } = renderNotices(notices(count));
      expect(shown()).toHaveLength(count);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      unmount();
    }
    renderNotices(notices(NOTICES_SHOWN + 1));
    expect(shown()).toHaveLength(NOTICES_SHOWN);
    expect(
      screen.getByRole('button', { name: `Show all ${NOTICES_SHOWN + 1} notices` })
    ).toBeInTheDocument();
  });

  it('shows nothing without notices', () => {
    const { container } = renderNotices([]);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
