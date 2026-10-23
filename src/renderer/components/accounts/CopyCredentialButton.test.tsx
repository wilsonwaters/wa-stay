/**
 * "Copy RAC member number" (R16): a detail the person saved for a provider, copyable, beside
 * the provider's booking and payment links: the place page's "Book on RAC" (StayCard), a
 * watch's, an alerted snipe's, and "Pay now" on a hold. Main writes the clipboard: a click
 * sends the provider and the field's key only, and nothing the window has holds the value.
 * Shown only while a copyable detail is saved; a copy is announced with focus kept, and a
 * failure shows main's reason. Made-up numbers only.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import { WatchResult } from '../../../shared/types/common.types';
import type { ProviderAccount } from '../../../shared/types/provider.types';
import {
  RAC_MEMBER_NUMBER_FIELD,
  RAC_SAVED,
  keyAccount,
  racAccount,
} from '@tests/fixtures/renderer/settings';
import { makeAlertedSnipe } from '@tests/fixtures/renderer/snipes';
import { makeUnit, makeWatch } from '@tests/fixtures/renderer/watches';
import { createMockApi, fail, ok } from '@tests/utils/renderer/createMockApi';
import { RAC_MANIFEST } from '@tests/utils/renderer/manifests';
import { politeAnnouncement, renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { AlertedPanel } from '../../features/snipes/shared/AlertedPanel';
import { StayCard } from '../../features/place/StayCard';
import { WatchAvailability } from '../../features/watches/detail/WatchAvailability';
import { HoldPanel } from '../stay/HoldPanel';
import { CopyCredentialButton } from './CopyCredentialButton';

const COPY = 'Copy RAC member number';
const BOOK_RAC = 'https://parksandresorts.rac.com.au/busselton/book-now/';

/** The mock API with these accounts listed, and `copyCredential` answering `copy`. */
function apiWith(accounts: ProviderAccount[], copy = jest.fn().mockResolvedValue(ok(undefined))) {
  return createMockApi({
    accounts: { list: jest.fn().mockResolvedValue(ok(accounts)), copyCredential: copy },
  });
}

const copyButton = () => screen.findByRole('button', { name: COPY });
/** Lets the accounts query settle, then says there is no copy button. */
async function expectNoCopyButton() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(screen.queryByRole('button', { name: /^Copy/ })).toBeNull();
}

describe('CopyCredentialButton', () => {
  it('copies through main with the provider and key only, announces it, and keeps focus', async () => {
    const copy = jest.fn().mockResolvedValue(ok(undefined));
    const { user } = renderWithProviders(<CopyCredentialButton providerId="rac" />, {
      api: apiWith([RAC_SAVED], copy),
    });
    const button = await copyButton();
    // The name is the label only: no value in the name, a title or a tooltip
    expect(button).toHaveAccessibleName(COPY);
    expect(button).not.toHaveAttribute('title');
    expect(screen.queryByRole('tooltip')).toBeNull();

    await user.click(button);
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith('rac', 'memberNumber');
    await waitFor(() => expect(politeAnnouncement()).toBe('RAC member number copied'));
    expect(button).toHaveFocus();
  });

  it("shows main's reason when the copy fails, and announces no copy", async () => {
    const copy = jest
      .fn()
      .mockResolvedValue(fail("Couldn't read your saved RAC member number. Add it again."));
    const { user } = renderWithProviders(<CopyCredentialButton providerId="rac" />, {
      api: apiWith([RAC_SAVED], copy),
    });
    await user.click(await copyButton());
    const toasts = screen.getByRole('region', { name: 'Notifications' });
    expect(
      await within(toasts).findByText("Couldn't read your saved RAC member number. Add it again.")
    ).toBeInTheDocument();
    expect(politeAnnouncement()).not.toMatch(/copied/);
  });

  it.each<[string, ProviderAccount[], string | undefined]>([
    ['nothing is saved', [racAccount()], 'rac'],
    [
      'the saved detail is not copyable',
      [
        racAccount({
          status: 'signed-in',
          fields: [{ ...RAC_MEMBER_NUMBER_FIELD, copyable: false }],
          savedFields: ['memberNumber'],
        }),
      ],
      'rac',
    ],
    ['the provider has no account', [], 'rac'],
    ['no provider is given', [RAC_SAVED], undefined],
  ])('is hidden when %s', async (_, accounts, providerId) => {
    renderWithProviders(<CopyCredentialButton providerId={providerId} />, {
      api: apiWith(accounts),
    });
    await expectNoCopyButton();
  });

  it("names another provider's detail by its own label, and goes once the detail is removed", async () => {
    const list = jest.fn().mockResolvedValue(ok([keyAccount({ savedFields: ['memberNumber'] })]));
    const mock = createMockApi({ accounts: { list } });
    renderWithProviders(<CopyCredentialButton providerId="keystay" />, { api: mock });
    expect(await screen.findByRole('button', { name: 'Copy member number' })).toBeInTheDocument();

    list.mockResolvedValue(ok([keyAccount()]));
    mock.emit('account:updated', keyAccount());
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Copy/ })).toBeNull());
  });
});

describe('beside "Book on RAC" and "Pay now"', () => {
  const NOW = new Date('2099-12-01T02:00:00Z');

  const places = {
    'the place page (StayCard)': () => (
      <StayCard
        providerId="rac"
        shortName="RAC"
        dates={{ arrival: '2099-12-11', departure: '2099-12-13' }}
        guests={{ adults: 2, children: 0, infants: 0 }}
        onDatesChange={jest.fn()}
        onGuestsChange={jest.fn()}
        minDate="2099-12-01"
        ability={{ kind: 'available' }}
        onCheck={jest.fn()}
        checking={false}
        slow={false}
        checked
        failure={null}
        onRetry={jest.fn()}
        links={{ book: BOOK_RAC }}
        unitNoun={{ one: 'spot', many: 'spots' }}
      />
    ),
    "a watch's page (WatchAvailability)": () => (
      <WatchAvailability
        watch={makeWatch({
          providerId: 'rac',
          stay: { ...makeWatch().stay, arrival: '2099-12-11', departure: '2099-12-13' },
          lastResult: WatchResult.FOUND,
          lastCheckedAt: new Date(NOW.getTime() - 60_000),
          lastAvailability: [makeUnit('cat:4', ['2099-12-11', '2099-12-12'])],
          bookingLink: { url: BOOK_RAC, arrival: '2099-12-11', departure: '2099-12-13' },
        })}
        manifest={RAC_MANIFEST}
        now={NOW}
      />
    ),
    "a watch's stay free only if you move (SplitStays)": () => (
      <WatchAvailability
        watch={makeWatch({
          providerId: 'rac',
          location: { externalId: 'busselton', name: 'RAC Busselton Holiday Park' },
          stay: { ...makeWatch().stay, arrival: '2099-12-11', departure: '2099-12-13' },
          lastResult: WatchResult.SPLIT_FOUND,
          lastCheckedAt: new Date(NOW.getTime() - 60_000),
          lastAvailability: [makeUnit('cat:4', ['2099-12-11', '2099-12-12'])],
          splitStays: [
            {
              unitKind: 'campsite',
              booking: 'contact',
              unitId: 'cat:4',
              unitName: 'Powered Site',
              contactUrl: 'https://parksandresorts.rac.com.au/busselton/contact-us/',
            },
          ],
        })}
        manifest={RAC_MANIFEST}
        now={NOW}
      />
    ),
    'an alerted snipe (AlertedPanel)': () => (
      <AlertedPanel
        snipe={makeAlertedSnipe({
          providerId: 'rac',
          alert: { at: NOW, unitId: 'cat:4', unitName: 'Powered Site', bookingUrl: BOOK_RAC },
        })}
        manifest={RAC_MANIFEST}
        actions={{ arm: jest.fn(), arming: false }}
        today="2099-12-01"
        now={NOW}
      />
    ),
    'a hold (HoldPanel)': () => (
      <HoldPanel
        unit="Powered Site"
        expiresAt={new Date(Date.now() + 20 * 60_000)}
        manifest={RAC_MANIFEST}
        label="Hold at Busselton"
        onPay={jest.fn()}
        paying={false}
      />
    ),
  };
  const anchors: Record<keyof typeof places, RegExp> = {
    'the place page (StayCard)': /^Book on RAC/,
    "a watch's page (WatchAvailability)": /^Book on RAC/,
    "a watch's stay free only if you move (SplitStays)": /^Contact RAC Busselton Holiday Park/,
    'an alerted snipe (AlertedPanel)': /^Book on RAC/,
    'a hold (HoldPanel)': /^Pay now$/,
  };

  it.each(Object.keys(places) as Array<keyof typeof places>)(
    '%s: right after its link or button while a member number is saved, and not otherwise',
    async (place) => {
      const { unmount } = renderWithProviders(places[place](), { api: apiWith([RAC_SAVED]) });
      const button = await copyButton();
      const anchor =
        screen.queryByRole('link', { name: anchors[place] }) ??
        screen.getByRole('button', { name: anchors[place] });
      // Beside it: the next control in the reading order
      expect(
        anchor.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(anchor.parentElement).toContainElement(button);
      unmount();

      renderWithProviders(places[place](), { api: apiWith([racAccount()]) });
      await expectNoCopyButton();
      expect(
        screen.queryByRole('link', { name: anchors[place] }) ??
          screen.getByRole('button', { name: anchors[place] })
      ).toBeInTheDocument();
    }
  );
});
