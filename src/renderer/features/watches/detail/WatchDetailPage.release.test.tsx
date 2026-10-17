/**
 * "Let it go" on a watch's automatic hold (R18): offered beside "Pay now" only for a provider
 * that can let a hold go (`holdRelease`), with an "about" expiry when the provider guessed it;
 * confirming calls `watches.releaseHold` through the hook, and the hold panel then says how the
 * hold ended (focus on its heading), never as "Last check failed". A watch whose hold was let go
 * shows the same when the page opens again. ParkStay offers none.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { WatchResult } from '../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { APIResponse } from '../../../../shared/types/api.types';
import type { Watch } from '../../../../shared/types/watch.types';
import { makeUnit, makeWatch } from '@tests/fixtures/renderer/watches';
import { PARKSTAY_MANIFEST, fail, ok } from '@tests/utils/renderer/createMockApi';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';
import { politeAnnouncement } from '@tests/utils/renderer/renderWithProviders';

/** A provider whose holds can be let go: the flag is the renderer's whole cue. */
const RELEASING: ProviderManifest = { ...PARKSTAY_MANIFEST, holdRelease: true };
const NIGHTS = ['2099-12-11', '2099-12-12'];
const HELD: Watch = makeWatch({
  id: 7,
  name: 'Osprey summer',
  lastResult: WatchResult.HELD,
  lastAvailability: [makeUnit('1', NIGHTS)],
  hold: {
    reference: 'H-1',
    unitId: '1',
    expiresAt: new Date(Date.now() + 20 * 60_000),
    expiresEstimated: true,
  },
});
const LET_GO: Watch = {
  ...HELD,
  hold: { ...HELD.hold!, expiresAt: new Date(Date.now() - 1000), expiresEstimated: undefined },
  lastError: "Fake no longer holds it. If you paid, look for Fake's confirmation email.",
};

/**
 * The page on `watch`; `released`, when given, is what main answers `releaseHold` with, and
 * what `get` answers from then on (as main would).
 */
function render(manifest: ProviderManifest, watch: Watch, released?: APIResponse<Watch>) {
  let current = watch;
  const releaseHold = jest.fn(async () => {
    if (released?.success) current = released.data;
    return released ?? ok(current);
  });
  const view = renderWithApp({
    route: '/watches/7',
    api: {
      providers: { list: jest.fn().mockResolvedValue(ok([manifest])) },
      watches: {
        get: jest.fn(async () => ok(current)),
        list: jest.fn().mockResolvedValue(ok([])),
        releaseHold,
      },
    },
  });
  return { ...view, releaseHold };
}

describe('WatchDetailPage: Let it go', () => {
  it('ParkStay (no holdRelease) offers only Pay now', async () => {
    render(PARKSTAY_MANIFEST, HELD);
    const hold = await screen.findByRole('region', { name: 'Hold at Osprey Bay' });
    expect(within(hold).getByRole('button', { name: 'Pay now' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Let it go' })).toBeNull();
  });

  it('an estimated expiry reads "about", in the panel and the summary', async () => {
    render(RELEASING, HELD);
    const hold = await screen.findByRole('region', { name: 'Hold at Osprey Bay' });
    expect(within(hold).getByText(/^Held until about /)).toBeInTheDocument();
    expect(
      within(hold).getByRole('timer', { name: /^About \d+ minutes left to pay$/ })
    ).toBeInTheDocument();
    const preferences = screen.getByRole('region', { name: 'Preferences' });
    expect(within(preferences).getByText(/^On: Site 1 held until about /)).toBeInTheDocument();
  });

  it('confirming lets it go through the hook, and the panel says how it ended', async () => {
    const { user, releaseHold } = render(RELEASING, HELD, ok(LET_GO));
    const hold = await screen.findByRole('region', { name: 'Hold at Osprey Bay' });

    await user.click(within(hold).getByRole('button', { name: 'Let it go' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Let this hold go?' });
    expect(dialog).toHaveAccessibleDescription(
      "Site 1 at Osprey Bay goes back on sale. You can't undo this."
    );
    await user.click(within(dialog).getByRole('button', { name: 'Let it go' }));

    expect(releaseHold).toHaveBeenCalledWith(7);
    const panel = screen.getByRole('region', { name: 'Hold at Osprey Bay' });
    const heading = await within(panel).findByRole('heading', { name: 'The hold has ended' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(within(panel).getByText(LET_GO.lastError!)).toBeInTheDocument();
    expect(screen.queryByText('Last check failed')).toBeNull();
    await waitFor(() => expect(politeAnnouncement()).toBe(LET_GO.lastError));
  });

  it('the error stays in the question', async () => {
    const { user } = render(RELEASING, HELD, fail('Fake did not answer', 'PROVIDER_ERROR'));
    const hold = await screen.findByRole('region', { name: 'Hold at Osprey Bay' });
    await user.click(within(hold).getByRole('button', { name: 'Let it go' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Let this hold go?' });
    await user.click(within(dialog).getByRole('button', { name: 'Let it go' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Fake did not answer');
  });

  it('a watch whose hold was let go shows how it ended when opened again', async () => {
    render(RELEASING, LET_GO);
    const panel = await screen.findByRole('region', { name: 'Hold at Osprey Bay' });
    expect(within(panel).getByRole('heading', { name: 'The hold has ended' })).toBeInTheDocument();
    expect(within(panel).getByText(LET_GO.lastError!)).toBeInTheDocument();
    expect(screen.queryByText('Last check failed')).toBeNull();
    const preferences = screen.getByRole('region', { name: 'Preferences' });
    expect(within(preferences).getByText('On: the hold on Site 1 ended')).toBeInTheDocument();
  });
});
