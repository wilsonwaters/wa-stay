import { act, screen, waitFor } from '@testing-library/react';
import { makeHeldSnipe } from '@tests/fixtures/renderer/snipes';
import { createMockApi, fail, ok, PARKSTAY_MANIFEST } from '@tests/utils/renderer/createMockApi';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { HeldPanel } from './HeldPanel';
import { useSnipeActions } from './useSnipeActions';

function Held({ snipe }: { snipe: SiteSnipe }) {
  const actions = useSnipeActions(snipe, PARKSTAY_MANIFEST);
  return <HeldPanel snipe={snipe} manifest={PARKSTAY_MANIFEST} actions={actions} />;
}

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
});
