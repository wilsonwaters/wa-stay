import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import { HoldPanel, type HoldPanelProps } from './HoldPanel';

function renderPanel(props: Partial<HoldPanelProps> = {}) {
  const onPay = jest.fn();
  const user = userEvent.setup();
  render(
    <HoldPanel
      unit="CAMPSITE 02"
      expiresAt={new Date(Date.now() + 23 * 60_000)}
      manifest={PARKSTAY_MANIFEST}
      label="Hold at Bungarra"
      onPay={onPay}
      paying={false}
      {...props}
    />
  );
  return { onPay, user, panel: () => screen.getByRole('region', { name: 'Hold at Bungarra' }) };
}

describe('HoldPanel', () => {
  afterEach(() => jest.useRealTimers());

  it('names the held unit, the expiry and the time left, and Pay now pays', async () => {
    const { onPay, user, panel } = renderPanel();
    expect(within(panel()).getByText('CAMPSITE 02 is held for you')).toBeInTheDocument();
    expect(
      within(panel()).getByText(/^Held until (?:\w{3} \d{1,2} \w{3}, )?\d{1,2}:\d{2} [ap]m AWST/)
    ).toBeInTheDocument();
    expect(
      within(panel()).getByRole('timer', { name: /^2[23] minutes left to pay$/ })
    ).toHaveTextContent(/^2[23]:\d{2}$/);
    // On a page: the coral action and how paying works, in the provider's own name.
    expect(
      within(panel()).getByText(
        'Pay on ParkStay before the hold runs out. The payment page opens in its own window, where ParkStay may ask you to sign in.'
      )
    ).toBeInTheDocument();
    await user.click(within(panel()).getByRole('button', { name: 'Pay now' }));
    expect(onPay).toHaveBeenCalledTimes(1);
  });

  it('uses the hold’s provider for its words', () => {
    const { panel } = renderPanel({ manifest: FAKE_MANIFEST });
    expect(
      within(panel()).getByText(new RegExp(`^Pay on ${FAKE_MANIFEST.shortName} before`))
    ).toBeInTheDocument();
  });

  it('in a card: no paying line, and the button stays while it pays', () => {
    const { panel } = renderPanel({ variant: 'card', paying: true });
    expect(within(panel()).queryByText(/^Pay on ParkStay/)).toBeNull();
    expect(within(panel()).getByRole('button', { name: 'Pay now' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('shows a hold without an expiry, with no timer', () => {
    const { panel } = renderPanel({ expiresAt: undefined });
    expect(within(panel()).getByText('CAMPSITE 02 is held for you')).toBeInTheDocument();
    expect(within(panel()).queryByRole('timer')).toBeNull();
    expect(within(panel()).getByRole('button', { name: 'Pay now' })).toBeInTheDocument();
  });

  it('drops the button and says so once the hold runs out on screen', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2099-06-01T00:00:00Z'));
    const { panel } = renderPanel({ expiresAt: new Date('2099-06-01T00:00:03Z') });
    expect(within(panel()).getByRole('button', { name: 'Pay now' })).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(within(panel()).queryByRole('button', { name: 'Pay now' })).toBeNull();
    expect(within(panel()).getByText('The hold has expired')).toBeInTheDocument();
    expect(
      within(panel()).getByText(
        'The hold on CAMPSITE 02 ran out before it was paid for, so ParkStay has released it.'
      )
    ).toBeInTheDocument();
  });
});
