import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import {
  politeAnnouncement,
  renderWithProviders,
} from '@tests/utils/renderer/renderWithProviders';
import { AppProviders } from '../../app/AppProviders';
import { ToastViewport } from '../ui';
import { HoldPanel, type HoldPanelProps } from './HoldPanel';

/** A provider that can let a hold go (`holdRelease`, with its holds on, R18). */
const RELEASING = {
  ...FAKE_MANIFEST,
  capabilities: { ...FAKE_MANIFEST.capabilities, holds: true },
  holdRelease: true,
};

function renderPanel(
  props: Partial<HoldPanelProps> = {},
  userOptions?: Parameters<typeof userEvent.setup>[0]
) {
  const onPay = jest.fn();
  const user = userEvent.setup(userOptions);
  const panelOf = (more: Partial<HoldPanelProps>) => (
    <HoldPanel
      unit="CAMPSITE 02"
      expiresAt={new Date(Date.now() + 23 * 60_000)}
      manifest={PARKSTAY_MANIFEST}
      label="Hold at Bungarra"
      onPay={onPay}
      paying={false}
      {...props}
      {...more}
    />
  );
  // The app's providers (React Query, toasts, the announcer): "Copy …" sits beside Pay now
  const { rerender, queryClient } = renderWithProviders(panelOf({}));
  return {
    onPay,
    user,
    panel: () => screen.getByRole('region', { name: 'Hold at Bungarra' }),
    rerender: (more: Partial<HoldPanelProps>) =>
      rerender(
        <AppProviders queryClient={queryClient}>
          {panelOf(more)}
          <ToastViewport />
        </AppProviders>
      ),
  };
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

  describe('an estimated expiry (R18)', () => {
    it('says "about" before the time, and the timer is named "About … left to pay"', () => {
      const { panel } = renderPanel({ expiresEstimated: true });
      expect(
        within(panel()).getByText(
          /^Held until about (?:\w{3} \d{1,2} \w{3}, )?\d{1,2}:\d{2} [ap]m AWST/
        )
      ).toBeInTheDocument();
      expect(
        within(panel()).getByRole('timer', { name: /^About 2[23] minutes left to pay$/ })
      ).toHaveTextContent(/^2[23]:\d{2}$/);
    });

    it('an exact expiry keeps its words', () => {
      const { panel } = renderPanel({ expiresEstimated: false });
      expect(within(panel()).queryByText(/about/i)).toBeNull();
      expect(
        within(panel()).getByRole('timer', { name: /^2[23] minutes left to pay$/ })
      ).toBeInTheDocument();
    });
  });

  describe('Let it go (R18)', () => {
    const letGo = () => screen.queryByRole('button', { name: 'Let it go' });

    it('is offered only for a provider that can let a hold go, its holds on, with an action, while the hold lasts', () => {
      const onRelease = jest.fn();
      const { rerender } = renderPanel({ onRelease, manifest: PARKSTAY_MANIFEST });
      // ParkStay: no holdRelease
      expect(letGo()).toBeNull();
      rerender({ manifest: RELEASING, onRelease: undefined });
      expect(letGo()).toBeNull();
      rerender({ manifest: RELEASING, onRelease, expiresAt: new Date(Date.now() - 1000) });
      expect(letGo()).toBeNull();
      // holdRelease standing alone, its holds off (after a restart without them): none
      rerender({
        manifest: { ...RELEASING, capabilities: { ...RELEASING.capabilities, holds: false } },
        onRelease,
      });
      expect(letGo()).toBeNull();
      rerender({ manifest: RELEASING, onRelease });
      expect(letGo()).toBeInTheDocument();
      // Beside Pay now
      expect(
        within(screen.getByRole('region', { name: 'Hold at Bungarra' })).getByRole('button', {
          name: 'Pay now',
        })
      ).toBeInTheDocument();
      expect(onRelease).not.toHaveBeenCalled();
    });

    it('asks first in an alertdialog: Cancel has focus, Escape cancels, focus returns to "Let it go"', async () => {
      const onRelease = jest.fn();
      const { user } = renderPanel({ manifest: RELEASING, onRelease, place: 'Bungarra' });

      await user.click(letGo()!);
      const dialog = screen.getByRole('alertdialog', { name: 'Let this hold go?' });
      expect(dialog).toHaveAccessibleDescription(
        "CAMPSITE 02 at Bungarra goes back on sale. You can't undo this."
      );
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
      expect(within(dialog).getByRole('button', { name: 'Let it go' })).toBeInTheDocument();

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(letGo()).toHaveFocus();

      await user.click(letGo()!);
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(letGo()).toHaveFocus();
      expect(onRelease).not.toHaveBeenCalled();
    });

    it('confirming lets it go, announces why, and once ended focus goes to the panel heading with the message', async () => {
      const onRelease = jest.fn().mockResolvedValue('You let it go.');
      const { user, rerender, panel } = renderPanel({
        manifest: RELEASING,
        onRelease,
        place: 'Bungarra',
      });

      await user.click(letGo()!);
      const dialog = screen.getByRole('alertdialog', { name: 'Let this hold go?' });
      await user.click(within(dialog).getByRole('button', { name: 'Let it go' }));

      expect(onRelease).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      // Said once the panel shows the ended hold
      expect(politeAnnouncement()).toBe('');

      // Main answers the ended hold: it expired now, with why
      rerender({
        manifest: RELEASING,
        onRelease,
        expiresAt: new Date(Date.now() - 1000),
        endedMessage: 'You let it go.',
      });
      const heading = within(panel()).getByRole('heading', { name: 'The hold has ended' });
      expect(heading).toHaveFocus();
      expect(within(panel()).getByText('You let it go.')).toBeInTheDocument();
      expect(letGo()).toBeNull();
      expect(within(panel()).queryByRole('button', { name: 'Pay now' })).toBeNull();
      await waitFor(() => expect(politeAnnouncement()).toBe('You let it go.'));
    });

    it('an error keeps the question open with the message, and the hold stays', async () => {
      const failure = new Error(
        "Fake couldn't be asked to let the hold go, so it stays until it runs out. You can still pay for it."
      );
      const onRelease = jest.fn().mockRejectedValue(failure);
      const { user, panel } = renderPanel({ manifest: RELEASING, onRelease });

      await user.click(letGo()!);
      const dialog = screen.getByRole('alertdialog', { name: 'Let this hold go?' });
      await user.click(within(dialog).getByRole('button', { name: 'Let it go' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(failure.message);
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(within(panel()).getByRole('button', { name: 'Pay now' })).toBeInTheDocument();
      expect(politeAnnouncement()).toBe('');
    });

    it('the hold running out while it asks closes the question, and focus goes to the heading', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2099-06-01T00:00:00Z'));
      const { user, panel } = renderPanel(
        {
          manifest: RELEASING,
          onRelease: jest.fn(),
          expiresAt: new Date('2099-06-01T00:00:05Z'),
        },
        { advanceTimers: jest.advanceTimersByTime }
      );
      await user.click(letGo()!);
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(6000);
      });

      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(within(panel()).getByRole('heading', { name: 'The hold has expired' })).toHaveFocus();
    });
  });
});
