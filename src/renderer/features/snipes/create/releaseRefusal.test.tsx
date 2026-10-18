/**
 * A provider that cannot time the stay in a mode that works out its own release (R14: RAC's
 * unannounced school holidays, or dates already open) refuses the create with `VALIDATION` on
 * `releaseAt`. The flow goes back to the Release step, and the refusal replaces the preview's
 * guess ("Release time unknown…") on that mode's card and in the Review, for that stay and mode
 * only. It is said once on screen, and announced.
 */
import { screen, waitFor, within } from '@testing-library/react';
import {
  ALERT_ONLY_MANIFEST,
  checkLocationWith,
  snipeFlowApi as api,
} from '@tests/fixtures/renderer/snipes';
import { makeLocationDetail } from '@tests/fixtures/renderer/watches';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';
import { RELEASE_UNKNOWN } from './releasePreview';

const ROUTE =
  '/site-sniper/new?provider=alertstay&location=20&arrival=2099-12-11&departure=2099-12-13';
const PLACE = makeLocationDetail({ key: 'alertstay:20', providerId: 'alertstay' });
const REFUSAL =
  "Alert Stay hasn't announced when these school holidays open at Osprey Bay. Set a watch, or choose a time you set.";

const button = (name: string) => screen.getByRole('button', { name });
const step = (name: RegExp) => screen.findByRole('heading', { level: 2, name });

describe('a release the provider refused', () => {
  it('replaces the preview on its card and in the Review, said once on screen and announced', async () => {
    const create = jest.fn().mockResolvedValue({
      success: false,
      code: 'VALIDATION',
      error: REFUSAL,
      issues: ['releaseAt'],
    });
    const mock = api(
      {
        snipes: { create },
        catalog: { checkLocation: checkLocationWith({ open: false }) },
      },
      [ALERT_ONLY_MANIFEST],
      PLACE
    );
    const { user } = renderWithApp({ route: ROUTE, api: mock });
    await step(/Your stay$/);
    await user.click(button('Continue'));
    await step(/Release and timing$/);
    const rolling = screen.getByRole('radio', { name: 'When these dates open' });
    await waitFor(() => expect(rolling).toHaveAccessibleDescription(new RegExp(RELEASE_UNKNOWN)));

    for (const name of ['Continue', 'Create snipe']) await user.click(button(name));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(await step(/Release and timing$/)).toBeInTheDocument();

    // The chosen mode's card says why, instead of "Release time unknown"
    const card = screen.getByRole('radio', { name: 'When these dates open' });
    expect(card).toHaveAccessibleDescription(`Dates open a year ahead, at midnight. ${REFUSAL}`);
    expect(screen.queryByText(RELEASE_UNKNOWN)).toBeNull();
    // Announced, and shown once: the alert is for screen readers only
    expect(screen.getByRole('alert')).toHaveTextContent(REFUSAL);
    expect(
      screen.getAllByText(REFUSAL).filter((el) => !el.classList.contains('sr-only'))
    ).toHaveLength(1);

    // The Review says it too, until something changes
    await user.click(button('Continue'));
    await step(/Review$/);
    expect(
      within(screen.getByRole('region', { name: 'Release' })).getByText(
        `When these dates open. ${REFUSAL}`
      )
    ).toBeInTheDocument();

    // Another mode is another question: the refusal is not carried to it
    await user.click(button('Change the release'));
    await step(/Release and timing$/);
    await user.click(screen.getByRole('radio', { name: 'At a scheduled time' }));
    expect(
      screen.getByRole('radio', { name: 'When these dates open' })
    ).toHaveAccessibleDescription(new RegExp(RELEASE_UNKNOWN));
  });

  it("shows the provider's reason from its check before anything is created (R16)", async () => {
    const create = jest.fn();
    const mock = api(
      {
        snipes: { create },
        catalog: { checkLocation: checkLocationWith({ open: false, refused: REFUSAL }) },
      },
      [ALERT_ONLY_MANIFEST],
      PLACE
    );
    const { user } = renderWithApp({ route: ROUTE, api: mock });
    await step(/Your stay$/);
    await user.click(button('Continue'));
    await step(/Release and timing$/);
    const rolling = screen.getByRole('radio', { name: 'When these dates open' });
    await waitFor(() =>
      expect(rolling).toHaveAccessibleDescription(
        `Dates open a year ahead, at midnight. ${REFUSAL}`
      )
    );
    expect(screen.queryByText(RELEASE_UNKNOWN)).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
