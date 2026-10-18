/**
 * Advanced timing's window and a release mode's limit (`maxWindowMinutes`, R12/R13): "Keep
 * trying for (minutes)" says the limit, a longer window is refused in the provider's words, the
 * limit itself is sent, and choosing a mode with a lower limit checks the field again.
 */
import { screen, waitFor } from '@testing-library/react';
import type { SiteSnipeInput } from '../../../../../shared/types/site-sniper.types';
import { ALERT_ONLY_MANIFEST, snipeFlowApi as api } from '@tests/fixtures/renderer/snipes';
import { makeLocationDetail } from '@tests/fixtures/renderer/watches';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

const ROUTE =
  '/site-sniper/new?provider=alertstay&location=20&arrival=2099-12-11&departure=2099-12-13';
const PLACE = makeLocationDetail({ key: 'alertstay:20', providerId: 'alertstay' });
const HINT = 'How long after the release to keep trying. Up to 30 minutes on Alert Stay.';
const ERROR = 'Alert Stay allows at most 30 minutes';

const button = (name: string) => screen.getByRole('button', { name });
const step = (name: RegExp) => screen.findByRole('heading', { level: 2, name });
const sent = (mock: jest.Mock): SiteSnipeInput => mock.mock.calls[0][0];
const keepTrying = () => screen.getByRole('textbox', { name: 'Keep trying for (minutes)' });

async function openTiming() {
  const mock = api({}, [ALERT_ONLY_MANIFEST], PLACE);
  const view = renderWithApp({ route: ROUTE, api: mock });
  await step(/Your stay$/);
  await view.user.click(button('Continue'));
  await step(/Release and timing$/);
  await view.user.click(button('Advanced timing'));
  return { ...view, mock };
}

describe('AdvancedTiming: the release mode’s limit on the window', () => {
  it('says the limit of a mode that has one', async () => {
    const { user } = await openTiming();
    expect(screen.getByRole('radio', { name: 'When these dates open' })).toBeChecked();
    expect(keepTrying()).toHaveAccessibleDescription(HINT);

    // A mode without a limit says nothing of one
    await user.click(screen.getByRole('radio', { name: 'At a scheduled time' }));
    expect(keepTrying()).toHaveAccessibleDescription('How long after the release to keep trying.');
  });

  it('refuses 45 minutes in the provider’s words, on Continue', async () => {
    const { user } = await openTiming();
    await user.clear(keepTrying());
    await user.type(keepTrying(), '45');
    await user.click(button('Continue'));
    await waitFor(() => expect(keepTrying()).toHaveFocus());
    expect(keepTrying()).toHaveAttribute('aria-invalid', 'true');
    expect(keepTrying()).toHaveAccessibleDescription(`${HINT} ${ERROR}`);
    expect(
      screen.getByRole('heading', { level: 2, name: /Release and timing$/ })
    ).toBeInTheDocument();
  });

  it('takes 30 minutes, and sends it', async () => {
    const { user, mock } = await openTiming();
    await user.clear(keepTrying());
    await user.type(keepTrying(), '30');
    await user.click(button('Continue'));
    await step(/Review$/);
    await user.click(button('Create snipe'));
    await waitFor(() => expect(mock.snipes.create).toHaveBeenCalledTimes(1));
    expect(sent(mock.snipes.create)).toMatchObject({
      providerId: 'alertstay',
      action: 'alert',
      releaseMode: 'daily_rollover',
      windowDurationMs: 30 * 60_000,
    });
  });

  it('checks the window again when a mode with a lower limit is chosen', async () => {
    const { user } = await openTiming();
    await user.click(screen.getByRole('radio', { name: 'At a scheduled time' }));
    await user.clear(keepTrying());
    await user.type(keepTrying(), '45');
    await user.tab();
    expect(keepTrying()).not.toHaveAttribute('aria-invalid');

    // The limit applies at once, without Continue; back to no limit, the error goes
    await user.click(screen.getByRole('radio', { name: 'When these dates open' }));
    await waitFor(() => expect(keepTrying()).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText(ERROR)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'At a scheduled time' }));
    await waitFor(() => expect(screen.queryByText(ERROR)).toBeNull());
  });
});
