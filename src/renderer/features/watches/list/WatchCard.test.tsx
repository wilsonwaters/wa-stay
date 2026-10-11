import { screen, waitFor, within } from '@testing-library/react';
import { WatchResult } from '../../../../shared/types/common.types';
import type { Watch, WatchExecutionResult } from '../../../../shared/types/watch.types';
import { PARKSTAY_MANIFEST, fail, ok } from '@tests/utils/renderer/createMockApi';
import { makeUnit, makeWatch } from '@tests/fixtures/renderer/watches';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { watchStateOf } from '../shared/watchState';
import { WatchCard, type WatchCardProps } from './WatchCard';
import { providerToday } from '../../../components/stay/providerToday';

const NOW = new Date();
const NIGHTS = ['2099-12-11', '2099-12-12'];

function renderCard(watch: Watch, api = {}, known = true, photo: Partial<WatchCardProps> = {}) {
  const manifest = known ? PARKSTAY_MANIFEST : undefined;
  const today = providerToday(manifest, NOW);
  return renderWithProviders(
    <WatchCard
      watch={watch}
      state={watchStateOf(watch, today, NOW)}
      manifest={manifest}
      now={NOW}
      today={today}
      {...photo}
    />,
    { route: '/watches', api }
  );
}

const card = () => screen.getByRole('article');
const toasts = () => screen.getByRole('region', { name: 'Notifications' });
const found: WatchExecutionResult = {
  watchId: 1,
  success: true,
  found: true,
  checkedAt: NOW,
  matches: ['1', '2', '3'].map((unitId) => ({
    unitId,
    unitName: `Site ${unitId}`,
    arrival: '2099-12-11',
    departure: '2099-12-13',
    partial: false,
    priceKnown: false,
  })),
};

describe('WatchCard', () => {
  it('shows provider, location, stay, last checked and result', async () => {
    renderCard(
      makeWatch({
        lastResult: WatchResult.FOUND,
        lastCheckedAt: new Date(NOW.getTime() - 12 * 60_000),
        foundCount: 4,
        lastAvailability: [makeUnit('1', NIGHTS), makeUnit('2', NIGHTS), makeUnit('3', NIGHTS)],
      })
    );
    const article = card();
    expect(await within(article).findByRole('img', { name: 'ParkStay WA' })).toBeInTheDocument();
    expect(within(article).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Osprey Bay · Fri 11 – Sun 13 Dec'
    );
    expect(
      within(article).getByRole('link', { name: 'Osprey Bay · Fri 11 – Sun 13 Dec' })
    ).toHaveAttribute('href', '#/watches/1');
    expect(within(article).getByText('Osprey Bay · Cape Range National Park')).toBeInTheDocument();
    expect(
      within(article).getByText(/Fri 11 – Sun 13 Dec 2099 · 2 nights · 2 adults/)
    ).toBeInTheDocument();
    expect(within(article).getByText('3 sites available')).toBeInTheDocument();
    expect(within(article).getByText(/Checked 12 min ago/)).toBeInTheDocument();
    expect(within(article).getByText(/Found 4 times/)).toBeInTheDocument();
    expect(within(article).getByText('Watching')).toBeInTheDocument();
  });

  it('has exactly one visible button and a More actions menu with Pause, Edit, Delete', async () => {
    const { user } = renderCard(makeWatch());
    const buttons = within(card()).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Check now',
      'More actions for Osprey Bay · Fri 11 – Sun 13 Dec',
    ]);
    await user.click(screen.getByRole('button', { name: /More actions for/ }));
    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent)
    ).toEqual(['Pause', 'Edit', 'Delete']);
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toHaveAttribute(
      'href',
      '#/watches/1/edit'
    );
  });

  it('More actions is a menu; Escape closes it and focuses the trigger', async () => {
    const { user } = renderCard(makeWatch({ isActive: false }));
    const trigger = screen.getByRole('button', { name: /More actions for/ });
    await user.click(trigger);
    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Resume' })
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('Check now announces "3 sites available at Osprey Bay", once for a double-click', async () => {
    let answer: (value: unknown) => void = () => undefined;
    const runNow = jest.fn(() => new Promise((resolve) => (answer = resolve)));
    const { user } = renderCard(makeWatch(), {
      watches: { runNow, list: jest.fn().mockResolvedValue(ok([])) },
    });
    const button = screen.getByRole('button', { name: 'Check now' });
    await user.dblClick(button);
    await user.click(button);
    expect(button).toHaveAttribute('aria-busy', 'true');
    answer(ok(found));
    expect(
      await within(toasts()).findByText('3 sites available at Osprey Bay')
    ).toBeInTheDocument();
    expect(runNow).toHaveBeenCalledTimes(1);
    expect(runNow).toHaveBeenCalledWith(1);
  });

  it('Check now announces "Nothing available yet"', async () => {
    const runNow = jest.fn().mockResolvedValue(ok({ ...found, found: false, matches: [] }));
    const { user } = renderCard(makeWatch(), {
      watches: { runNow, list: jest.fn().mockResolvedValue(ok([])) },
    });
    await user.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await within(toasts()).findByText('Nothing available yet')).toBeInTheDocument();
  });

  it('Delete asks in a ConfirmDialog, then deletes', async () => {
    const remove = jest.fn().mockResolvedValue(ok(true));
    const { user } = renderCard(makeWatch(), {
      watches: { delete: remove, list: jest.fn().mockResolvedValue(ok([])) },
    });
    await user.click(screen.getByRole('button', { name: /More actions for/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog', {
      name: 'Delete Osprey Bay · Fri 11 – Sun 13 Dec?',
    });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete watch' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(1));
    expect(await within(toasts()).findByText('Watch deleted')).toBeInTheDocument();
  });

  it('a held watch offers Pay now, and says when the hold has expired', async () => {
    const openPayment = jest.fn().mockResolvedValue(fail('gone', 'HOLD_EXPIRED'));
    const held = makeWatch({
      lastResult: WatchResult.HELD,
      hold: { reference: 'PB1', unitId: '12', expiresAt: new Date(NOW.getTime() + 20 * 60_000) },
    });
    const { user } = renderCard(held, {
      watches: { openPayment, list: jest.fn().mockResolvedValue(ok([])) },
    });
    expect(within(card()).getByText('Site held')).toBeInTheDocument();
    // The hold panel a snipe's card has: the unit, the time left, and Pay now in it.
    const hold = within(card()).getByRole('region', { name: 'Hold at Osprey Bay' });
    expect(within(hold).getByText('Site 12 is held for you')).toBeInTheDocument();
    expect(within(hold).getByRole('timer', { name: /left to pay$/ })).toBeInTheDocument();
    expect(within(card()).queryByRole('button', { name: 'Check now' })).toBeNull();
    expect(within(card()).getAllByRole('button', { name: 'Pay now' })).toHaveLength(1);
    await user.click(within(hold).getByRole('button', { name: 'Pay now' }));
    expect(openPayment).toHaveBeenCalledWith(1);
    expect(
      await within(toasts()).findByText('This hold has expired, so it can no longer be paid for.')
    ).toBeInTheDocument();
  });

  it('a booked watch links to Bookings and only offers Delete', async () => {
    const { user } = renderCard(makeWatch({ lastResult: WatchResult.BOOKED, isActive: false }));
    expect(within(card()).getByRole('link', { name: 'See it in Bookings' })).toHaveAttribute(
      'href',
      '#/bookings'
    );
    expect(within(card()).getAllByRole('button')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /More actions for/ }));
    expect(
      within(screen.getByRole('menu'))
        .getAllByRole('menuitem')
        .map((i) => i.textContent)
    ).toEqual(['Delete']);
  });

  it('an ended watch shows Ended and has no Check now', () => {
    renderCard(
      makeWatch({ stay: { ...makeWatch().stay, arrival: '2000-01-01', departure: '2000-01-03' } })
    );
    expect(within(card()).getByText('Ended')).toBeInTheDocument();
    expect(within(card()).queryByRole('button', { name: 'Check now' })).toBeNull();
  });

  it('a watch of an unknown provider keeps only Delete enabled', async () => {
    const { user } = renderCard(makeWatch({ providerId: 'rac' }), {}, false);
    expect(within(card()).getByRole('img', { name: 'Unknown provider' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /More actions for/ }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Pause' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).not.toHaveAttribute(
      'aria-disabled'
    );
  });

  it('says when the last check failed', () => {
    renderCard(
      makeWatch({
        lastResult: WatchResult.ERROR,
        lastCheckedAt: new Date(NOW.getTime() - 3_600_000 * 2),
      })
    );
    expect(within(card()).getByText('Last check failed')).toBeInTheDocument();
    expect(within(card()).getByText(/Checked 2 h ago/)).toBeInTheDocument();
  });

  it('leads with the place’s photo, named by the place; a skeleton while the catalogue answers', () => {
    const place = { kind: 'campground' as const, imageUrls: ['https://example.org/osprey.jpg'] };
    const { unmount } = renderCard(makeWatch(), {}, true, { place });
    const photo = within(card()).getByRole('img', { name: 'Osprey Bay' });
    expect(photo).toHaveAttribute('src', 'https://example.org/osprey.jpg');
    unmount();
    renderCard(makeWatch(), {}, true, { placeLoading: true });
    expect(within(card()).queryByRole('img', { name: /Osprey Bay/ })).toBeNull();
  });

  it('keeps a long name whole in the accessible name while it truncates visually', () => {
    const name = 'A very long watch name that goes on and on about Osprey Bay in December';
    renderCard(makeWatch({ name }));
    expect(within(card()).getByRole('link', { name })).toBeInTheDocument();
    expect(screen.getByRole('article', { name })).toBeInTheDocument();
  });
});
