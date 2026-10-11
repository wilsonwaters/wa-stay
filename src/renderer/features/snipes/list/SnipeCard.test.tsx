import { act, screen, waitFor, within } from '@testing-library/react';
import { SnipeReleaseMode, SnipeStatus } from '../../../../shared/types/common.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import {
  ACCOUNT_REQUIRED_MANIFEST,
  makeHeldSnipe,
  makeSnipe,
} from '@tests/fixtures/renderer/snipes';
import { createMockApi, fail, ok, PARKSTAY_MANIFEST } from '@tests/utils/renderer/createMockApi';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { SnipeCard } from './SnipeCard';

function renderCard(snipe: SiteSnipe, stubs = {}, manifest = PARKSTAY_MANIFEST) {
  const mock = createMockApi(stubs);
  const view = renderWithProviders(
    <SnipeCard snipe={snipe} manifest={manifest} today="2099-06-01" />,
    { api: mock }
  );
  const card = screen.getByRole('article', { name: snipe.name });
  return { ...view, mock, card };
}

const buttons = (card: HTMLElement) =>
  within(card)
    .getAllByRole('button')
    .map((b) => b.textContent || b.getAttribute('aria-label'));

describe('SnipeCard', () => {
  it.each<[string, Partial<SiteSnipe>, string[]]>([
    ['paused', { status: SnipeStatus.DISABLED, isActive: false }, ['Arm']],
    ['armed', {}, ['Disarm']],
    ['sniping', { status: SnipeStatus.SNIPING }, ['Disarm']],
    ['expired', { status: SnipeStatus.EXPIRED, isActive: false }, ['Arm again']],
    [
      'failed',
      { status: SnipeStatus.FAILED, isActive: false, lastError: 'Night taken' },
      ['Arm again'],
    ],
  ])('a %s snipe leads with its one action', (_name, overrides, expected) => {
    const snipe = makeSnipe(overrides);
    const { card } = renderCard(snipe);
    expect(buttons(card)).toEqual([...expected, `More actions for ${snipe.name}`]);
  });

  it('a held snipe leads with Pay now, and is never offered Arm', () => {
    const { card } = renderCard(makeHeldSnipe());
    expect(buttons(card)).toEqual(['Pay now', `More actions for ${makeHeldSnipe().name}`]);
    expect(within(card).getByText('Site 12 is held for you')).toBeInTheDocument();
  });

  it('a booked snipe links to Bookings', () => {
    const snipe = makeHeldSnipe(10, { status: SnipeStatus.BOOKED, bookedReference: 'PB123' });
    const { card } = renderCard(snipe);
    expect(within(card).getByRole('link', { name: 'View booking' })).toHaveAttribute(
      'href',
      '#/bookings?q=PB123'
    );
    expect(within(card).getByText('Booked on ParkStay · PB123')).toBeInTheDocument();
  });

  it('arms and disarms through main', async () => {
    const activate = jest.fn().mockResolvedValue(ok(undefined));
    const paused = makeSnipe({ status: SnipeStatus.DISABLED, isActive: false });
    const { user, card } = renderCard(paused, { snipes: { activate } });
    await user.click(within(card).getByRole('button', { name: 'Arm' }));
    expect(activate).toHaveBeenCalledWith(7);
    expect(await screen.findByText(`Armed ${paused.name}`)).toBeInTheDocument();
  });

  it('says honestly when main refuses to arm it', async () => {
    const activate = jest
      .fn()
      .mockResolvedValue(fail('This snipe already holds a site', 'VALIDATION'));
    const { user, card } = renderCard(makeSnipe({ status: SnipeStatus.EXPIRED, isActive: false }), {
      snipes: { activate },
    });
    await user.click(within(card).getByRole('button', { name: 'Arm again' }));
    expect(await screen.findByText('This snipe already holds a site')).toBeInTheDocument();
  });

  it('has View details, Run now and Delete in its menu', async () => {
    const runNow = jest
      .fn()
      .mockResolvedValue(
        ok({ snipeId: 7, success: true, result: 'too_early', held: false, checkedAt: new Date() })
      );
    const snipe = makeSnipe();
    const { user, card } = renderCard(snipe, { snipes: { runNow } });
    await user.click(within(card).getByRole('button', { name: `More actions for ${snipe.name}` }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'View details' })).toHaveAttribute(
      'href',
      '#/site-sniper/7'
    );
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: 'Run now' }));
    expect(runNow).toHaveBeenCalledWith(7);
    expect(
      await screen.findByText(
        "Osprey Bay isn't released yet. Site Sniper tries again at the release."
      )
    ).toBeInTheDocument();
  });

  it('warns that deleting a held snipe does not release the hold', async () => {
    const remove = jest.fn().mockResolvedValue(ok(true));
    const held = makeHeldSnipe();
    const { user, card } = renderCard(held, { snipes: { delete: remove } });
    await user.click(within(card).getByRole('button', { name: `More actions for ${held.name}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog', { name: `Delete ${held.name}?` });
    expect(dialog).toHaveTextContent('Deleting does not release the hold on ParkStay.');
    await user.click(within(dialog).getByRole('button', { name: 'Delete snipe' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(7));
  });

  it('watches for cancellations without a countdown', () => {
    const { card } = renderCard(
      makeSnipe({ releaseMode: SnipeReleaseMode.CANCELLATION, releaseAt: undefined })
    );
    expect(within(card).getByText('Watching for cancellations')).toBeInTheDocument();
    expect(within(card).queryByRole('timer')).toBeNull();
  });

  it('says Opening now once an armed snipe’s release has passed, never a negative count', () => {
    const { card } = renderCard(makeSnipe({ releaseAt: new Date(Date.now() - 60_000) }));
    expect(within(card).getByText('Opening now')).toBeInTheDocument();
    expect(within(card).queryByRole('timer')).toBeNull();
  });

  it('asks to connect a provider whose holds need an account, and Arm opens the prompt instead', async () => {
    const activate = jest.fn();
    const signIn = jest
      .fn()
      .mockResolvedValue(
        ok({ providerId: 'fakestay', requirement: 'required-for-holds', status: 'signed-out' })
      );
    const snipe = makeSnipe({
      providerId: 'fakestay',
      status: SnipeStatus.DISABLED,
      isActive: false,
    });
    const accounts = {
      list: jest
        .fn()
        .mockResolvedValue(
          ok([{ providerId: 'fakestay', requirement: 'required-for-holds', status: 'signed-out' }])
        ),
      signIn,
    };
    const { user, card } = renderCard(
      snipe,
      { snipes: { activate }, accounts },
      ACCOUNT_REQUIRED_MANIFEST
    );
    expect(
      await within(card).findByRole('button', { name: 'Connect Fake Stay' })
    ).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Arm' }));
    const dialog = await screen.findByRole('dialog', {
      name: `Connect Fake Stay to arm ${snipe.name}`,
    });
    expect(activate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Connect Fake Stay' }));
    expect(signIn).toHaveBeenCalledWith('fakestay');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(activate).not.toHaveBeenCalled();
  });

  it('stays quiet about an optional account on a card (ParkStay)', async () => {
    const { card } = renderCard(makeSnipe(), {
      accounts: {
        list: jest
          .fn()
          .mockResolvedValue(
            ok([{ providerId: 'parkstay', requirement: 'optional', status: 'signed-out' }])
          ),
      },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(within(card).queryByRole('button', { name: 'Connect ParkStay' })).toBeNull();
  });

  it.each<[string, Partial<SiteSnipe>]>([
    ['paused', { status: SnipeStatus.DISABLED, isActive: false }],
    ['failed', { status: SnipeStatus.FAILED, isActive: false }],
    ['expired', { status: SnipeStatus.EXPIRED, isActive: false }],
  ])('offers no Run now on a %s snipe, which main would refuse', async (_name, overrides) => {
    const snipe = makeSnipe(overrides);
    const { user, card } = renderCard(snipe);
    await user.click(within(card).getByRole('button', { name: `More actions for ${snipe.name}` }));
    expect(screen.queryByRole('menuitem', { name: 'Run now' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'View details' })).toBeInTheDocument();
  });

  it('opens the Connect prompt when main says arming needs a sign-in after all', async () => {
    const activate = jest
      .fn()
      .mockResolvedValue(fail('Sign in to ParkStay to hold a site', 'AUTH_REQUIRED'));
    const paused = makeSnipe({ status: SnipeStatus.DISABLED, isActive: false });
    const { user, card } = renderCard(paused, { snipes: { activate } });
    await user.click(within(card).getByRole('button', { name: 'Arm' }));
    expect(
      await screen.findByRole('dialog', { name: `Connect ParkStay to arm ${paused.name}` })
    ).toBeInTheDocument();
    expect(screen.queryByText('Sign in to ParkStay to hold a site')).toBeNull();
  });
});
