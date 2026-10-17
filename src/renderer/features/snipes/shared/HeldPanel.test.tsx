import { act, screen, waitFor } from '@testing-library/react';
import { makeHeldSnipe } from '@tests/fixtures/renderer/snipes';
import { createMockApi, fail, ok, PARKSTAY_MANIFEST } from '@tests/utils/renderer/createMockApi';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { HeldPanel } from './HeldPanel';
import { useSnipeActions } from './useSnipeActions';

function Held({
  snipe,
  manifest = PARKSTAY_MANIFEST,
  variant,
}: {
  snipe: SiteSnipe;
  manifest?: ProviderManifest;
  variant?: 'page' | 'card';
}) {
  const actions = useSnipeActions(snipe, manifest);
  return <HeldPanel snipe={snipe} manifest={manifest} actions={actions} variant={variant} />;
}

/** A provider whose holds can be let go (`holdRelease`, R18). */
const RELEASING: ProviderManifest = { ...PARKSTAY_MANIFEST, holdRelease: true };

describe('HeldPanel', () => {
  afterEach(() => jest.useRealTimers());

  it('shows the hold’s expiry and time left, and Pay now opens the payment window in main', async () => {
    const openPayment = jest.fn().mockResolvedValue(ok(undefined));
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    const snipe = makeHeldSnipe(23);
    const { user } = renderWithProviders(<Held snipe={snipe} />, {
      api: { snipes: { openPayment } },
    });
    expect(
      screen.getByText(/Held until (?:\w{3} \d{1,2} \w{3}, )?\d{1,2}:\d{2} [ap]m AWST/)
    ).toBeInTheDocument();
    expect(screen.getByRole('timer', { name: /^2[23] minutes left to pay$/ })).toHaveTextContent(
      /^2[23]:\d{2}$/
    );
    expect(screen.getByText(/^Pay on ParkStay before the hold runs out\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pay now' }));
    expect(openPayment).toHaveBeenCalledWith(7);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('drops the button and says so once the hold runs out', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2099-06-01T00:00:00Z'));
    const snipe = makeHeldSnipe(0, { holdExpiresAt: new Date('2099-06-01T00:00:03Z') });
    renderWithProviders(<Held snipe={snipe} />);
    expect(screen.getByRole('button', { name: 'Pay now' })).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.queryByRole('button', { name: 'Pay now' })).toBeNull();
    expect(screen.getByText('The hold has expired')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The hold on Site 12 ran out before it was paid for, so ParkStay has released it.'
      )
    ).toBeInTheDocument();
  });

  it('shows a hold without an expiry, with no timer', () => {
    renderWithProviders(<Held snipe={makeHeldSnipe(10, { holdExpiresAt: undefined })} />);
    expect(screen.getByText('Site 12 is held for you')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pay now' })).toBeInTheDocument();
  });

  it('keeps the button when the payment window fails, refetches, and says why', async () => {
    const list = jest.fn().mockResolvedValue(ok([]));
    const openPayment = jest
      .fn()
      .mockResolvedValueOnce(fail('The hold is gone', 'HOLD_EXPIRED'))
      .mockResolvedValueOnce(fail('ParkStay did not answer', 'PROVIDER_ERROR'));
    const mock = createMockApi({ snipes: { list, openPayment } });
    const { user, queryClient } = renderWithProviders(<Held snipe={makeHeldSnipe()} />, {
      api: mock,
    });
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');

    await user.click(screen.getByRole('button', { name: 'Pay now' }));
    expect(
      await screen.findByText('This hold has expired, so it can no longer be paid for.')
    ).toBeInTheDocument();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['snipes'] }));
    expect(screen.getByRole('button', { name: 'Pay now' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pay now' }));
    expect(
      await screen.findByText("The payment page couldn't be opened. ParkStay did not answer")
    ).toBeInTheDocument();
  });

  it('offers "Let it go" on the page for a provider that can let a hold go, never in a card, never for ParkStay', () => {
    const snipe = makeHeldSnipe(23);
    const { unmount } = renderWithProviders(<Held snipe={snipe} manifest={RELEASING} />);
    expect(screen.getByRole('button', { name: 'Let it go' })).toBeInTheDocument();
    unmount();
    const card = renderWithProviders(<Held snipe={snipe} manifest={RELEASING} variant="card" />);
    expect(screen.queryByRole('button', { name: 'Let it go' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pay now' })).toBeInTheDocument();
    card.unmount();
    renderWithProviders(<Held snipe={snipe} />);
    expect(screen.queryByRole('button', { name: 'Let it go' })).toBeNull();
  });

  it('an estimated expiry reads "about"', () => {
    renderWithProviders(<Held snipe={makeHeldSnipe(23, { holdExpiresEstimated: true })} />);
    expect(screen.getByText(/^Held until about /)).toBeInTheDocument();
    expect(
      screen.getByRole('timer', { name: /^About 2[23] minutes left to pay$/ })
    ).toBeInTheDocument();
  });
});
