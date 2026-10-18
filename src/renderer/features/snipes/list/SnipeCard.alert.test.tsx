/**
 * Alert snipes on their card (R13): the alert sent, with when, what was free and "Book on
 * {shortName}"; Arm again, after which focus moves to the card's status; no account asked for an
 * alert; and Run now's words when the dates are free. A failure after the provider turned the
 * snipe away shows why, and offers Arm again.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { SnipeStatus } from '../../../../shared/types/common.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import {
  ACCOUNT_REQUIRED_MANIFEST,
  makeAlertedSnipe,
  makeSnipe,
} from '@tests/fixtures/renderer/snipes';
import { createMockApi, ok, PARKSTAY_MANIFEST } from '@tests/utils/renderer/createMockApi';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { SnipesPage } from '../SnipesPage';
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

describe('SnipeCard: alerts', () => {
  it('an alerted snipe: "Alert sent" with its time, what was free, "Book on ParkStay", and Arm again', () => {
    const snipe = makeAlertedSnipe();
    const { card } = renderCard(snipe);
    expect(within(card).getByText('Status:', { exact: false }).closest('p')).toHaveTextContent(
      'Status: Alert sent'
    );
    expect(
      within(card).getByText(
        /^Alert sent \d{1,2}:\d{2} [ap]m AWST(?: · \d{1,2}:\d{2} [ap]m your time)? · CAMPSITE 03 was free$/
      )
    ).toBeInTheDocument();
    const link = within(card).getByRole('link', {
      name: 'Book on ParkStay (opens in your browser)',
    });
    expect(link).toHaveAttribute('href', snipe.alert!.bookingUrl);
    expect(within(card).getByText('Step 4 of 4: Alert sent', { exact: false })).toBeInTheDocument();
    expect(buttons(card)).toEqual(['Arm again', `More actions for ${snipe.name}`]);
  });

  it('an alerted snipe without a booking page has no link', () => {
    const snipe = makeAlertedSnipe({
      alert: { at: new Date(), unitId: '3', unitName: 'CAMPSITE 03' },
    });
    const { card } = renderCard(snipe);
    expect(within(card).getByText(/CAMPSITE 03 was free$/)).toBeInTheDocument();
    expect(within(card).queryByRole('link', { name: /^Book on/ })).toBeNull();
  });

  it('shows why a snipe failed after the provider turned it away, and offers Arm again', () => {
    const lastError =
      "ParkStay refused the check (HTTP 429). Site Sniper stopped and won't try again by itself.";
    const snipe = makeSnipe({ status: SnipeStatus.FAILED, isActive: false, lastError });
    const { card } = renderCard(snipe);
    expect(within(card).getByText(lastError)).toBeInTheDocument();
    expect(buttons(card)).toEqual(['Arm again', `More actions for ${snipe.name}`]);
  });

  it('after Arm again, focus moves to its status, never to the page body', async () => {
    const activate = jest.fn().mockResolvedValue(ok(undefined));
    const snipe = makeAlertedSnipe();
    const { user, card } = renderCard(snipe, { snipes: { activate } });
    await user.click(within(card).getByRole('button', { name: 'Arm again' }));
    expect(activate).toHaveBeenCalledWith(7);
    const status = within(card).getByText('Status:', { exact: false }).closest('p')!;
    await waitFor(() => expect(status).toHaveFocus());
  });

  it('an alert snipe needs no account: no Connect prompt, and Arm arms', async () => {
    const activate = jest.fn().mockResolvedValue(ok(undefined));
    const snipe = makeSnipe({
      providerId: 'fakestay',
      action: 'alert',
      status: SnipeStatus.DISABLED,
      isActive: false,
    });
    const accounts = {
      list: jest
        .fn()
        .mockResolvedValue(
          ok([{ providerId: 'fakestay', requirement: 'required-for-holds', status: 'signed-out' }])
        ),
    };
    const { user, card } = renderCard(
      snipe,
      { snipes: { activate }, accounts },
      ACCOUNT_REQUIRED_MANIFEST
    );
    await user.click(within(card).getByRole('button', { name: 'Arm' }));
    expect(activate).toHaveBeenCalledWith(7);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Connect Fake Stay' })).toBeNull();
  });

  it('Run now that finds the dates free says what is free and where to book it (by id, before the alert arrives)', async () => {
    const runNow = jest.fn().mockResolvedValue(
      ok({
        snipeId: 7,
        success: true,
        result: 'alerted',
        held: false,
        matchedSiteId: '3',
        checkedAt: new Date(),
      })
    );
    const snipe = makeSnipe({ action: 'alert', status: SnipeStatus.SNIPING });
    const { user, card } = renderCard(snipe, { snipes: { runNow } });
    await user.click(within(card).getByRole('button', { name: `More actions for ${snipe.name}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Run now' }));
    expect(
      await screen.findByText('Site 3 is free at Osprey Bay. Book on ParkStay.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Tried /)).toBeNull();
  });

  it('Run now names the unit as the alert main sent back does, as the card and panel do', async () => {
    const sniping = makeSnipe({ action: 'alert', status: SnipeStatus.SNIPING });
    const alerted = makeAlertedSnipe();
    const list = jest.fn().mockResolvedValue(ok([sniping]));
    const runNow = jest.fn().mockImplementation(async () => {
      // Main pushes the changed snipe before it answers
      list.mockResolvedValue(ok([alerted]));
      mock.emit('snipe:updated', alerted);
      return ok({
        snipeId: 7,
        success: true,
        result: 'alerted',
        held: false,
        matchedSiteId: '3',
        checkedAt: new Date(),
      });
    });
    const mock = createMockApi({ snipes: { list, runNow } });
    const { user } = renderWithProviders(<SnipesPage />, { api: mock });
    const card = await screen.findByRole('article', { name: sniping.name });
    await user.click(
      within(card).getByRole('button', { name: `More actions for ${sniping.name}` })
    );
    await user.click(screen.getByRole('menuitem', { name: 'Run now' }));
    const toasts = screen.getByRole('region', { name: 'Notifications' });
    expect(
      await within(toasts).findByText('CAMPSITE 03 is free at Osprey Bay. Book on ParkStay.')
    ).toBeInTheDocument();
    expect(within(card).getByText(/CAMPSITE 03 was free$/)).toBeInTheDocument();
  });
});
