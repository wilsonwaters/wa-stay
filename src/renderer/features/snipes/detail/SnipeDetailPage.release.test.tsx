/**
 * "Let it go" on a held snipe's page (R18): offered beside "Pay now" only for a provider that can
 * let a hold go (`holdRelease`); confirming calls `snipes.releaseHold` through the hook; the hold
 * panel then says how it ended (its heading takes focus, the message is announced) instead of the
 * ended snipe's notice; an error stays in the question. ParkStay offers none.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { SnipeResult, SnipeStatus } from '../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { makeHeldSnipe } from '@tests/fixtures/renderer/snipes';
import { catalogGet, makeLocationDetail } from '@tests/fixtures/renderer/watches';
import { PARKSTAY_MANIFEST, fail, ok } from '@tests/utils/renderer/createMockApi';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';
import { politeAnnouncement } from '@tests/utils/renderer/renderWithProviders';

/** A provider whose holds can be let go: the flag is the renderer's whole cue. */
const RELEASING: ProviderManifest = { ...PARKSTAY_MANIFEST, holdRelease: true };
const detail = makeLocationDetail({
  units: [{ unitId: '12', unitName: 'Site 12 (powered)', unitType: 'Powered' }],
});

function render(manifest: ProviderManifest, releaseHold = jest.fn()) {
  const held = makeHeldSnipe(23);
  const view = renderWithApp({
    route: '/site-sniper/7',
    api: {
      providers: { list: jest.fn().mockResolvedValue(ok([manifest])) },
      snipes: { get: jest.fn().mockResolvedValue(ok(held)), releaseHold },
      catalog: { get: catalogGet(detail) },
    },
  });
  return { ...view, held, releaseHold };
}

/** What main answers once it let the hold go: EXPIRED now, with why. */
function ended(held: SiteSnipe): SiteSnipe {
  return {
    ...held,
    status: SnipeStatus.EXPIRED,
    lastResult: SnipeResult.EXPIRED,
    lastError: 'You let it go.',
    holdExpiresAt: new Date(Date.now() - 1000),
  };
}

describe('SnipeDetailPage: Let it go', () => {
  it('ParkStay (no holdRelease) offers only Pay now', async () => {
    render(PARKSTAY_MANIFEST);
    const hold = await screen.findByRole('region', { name: 'Hold at Osprey Bay' });
    expect(within(hold).getByRole('button', { name: 'Pay now' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Let it go' })).toBeNull();
  });

  it('confirming lets it go through the hook; the panel says how it ended, with focus on its heading', async () => {
    const releaseHold = jest.fn();
    const { user, held } = render(RELEASING, releaseHold);
    releaseHold.mockResolvedValue(ok(ended(held)));
    const hold = await screen.findByRole('region', { name: 'Hold at Osprey Bay' });
    await within(hold).findByText('Site 12 (powered) is held for you');

    await user.click(within(hold).getByRole('button', { name: 'Let it go' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Let this hold go?' });
    expect(dialog).toHaveAccessibleDescription(
      "Site 12 (powered) at Osprey Bay goes back on sale. You can't undo this."
    );
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Let it go' }));

    expect(releaseHold).toHaveBeenCalledWith(7);
    const panel = screen.getByRole('region', { name: 'Hold at Osprey Bay' });
    const heading = await within(panel).findByRole('heading', { name: 'The hold has ended' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(within(panel).getByText('You let it go.')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /Pay now|Let it go/ })).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(politeAnnouncement()).toBe('You let it go.'));
    // The page says it once: no ended-snipe notice repeating it
    expect(within(screen.getByRole('main')).getAllByText('You let it go.')).toHaveLength(1);
  });

  it('an error stays in the question, and the hold stays payable', async () => {
    const releaseHold = jest
      .fn()
      .mockResolvedValue(
        fail(
          "ParkStay couldn't be asked to let the hold go, so it stays until it runs out. You can still pay for it.",
          'PROVIDER_ERROR'
        )
      );
    const { user } = render(RELEASING, releaseHold);
    const hold = await screen.findByRole('region', { name: 'Hold at Osprey Bay' });
    await user.click(await within(hold).findByRole('button', { name: 'Let it go' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Let this hold go?' });
    await user.click(within(dialog).getByRole('button', { name: 'Let it go' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^ParkStay couldn't be asked to let the hold go/
    );
    expect(within(hold).getByRole('button', { name: 'Pay now' })).toBeInTheDocument();
  });
});
