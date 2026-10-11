import { screen, waitFor, within } from '@testing-library/react';
import type { AccessStatus } from '../../../shared/types/provider.types';
import {
  createMockApi,
  fail,
  ok,
  PARKSTAY_MANIFEST,
  type MockApi,
} from '@tests/utils/renderer/createMockApi';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

const FAKE_GATED = { ...PARKSTAY_MANIFEST, id: 'fake', name: 'Fake Parks', shortName: 'Fake' };
const NO_GATE = {
  ...PARKSTAY_MANIFEST,
  id: 'nogate',
  name: 'No Gate',
  shortName: 'NoGate',
  capabilities: { ...PARKSTAY_MANIFEST.capabilities, accessGate: false },
};

const status = (
  state: AccessStatus['state'],
  extra: Partial<AccessStatus> = {},
  providerId = 'parkstay'
): AccessStatus => ({ providerId, state, updatedAt: new Date().toISOString(), ...extra });

const chip = (name = 'ParkStay queue') => screen.queryByRole('region', { name });
const politeRegion = () => document.querySelector('[aria-live="polite"][aria-atomic="true"]');

function renderTray(initial: AccessStatus, manifests: unknown[] = [PARKSTAY_MANIFEST]): MockApi {
  const accessStatus = jest.fn(async (providerId: string) =>
    ok(providerId === initial.providerId ? initial : status('idle', {}, providerId))
  );
  const mock = createMockApi({
    providers: { list: jest.fn().mockResolvedValue(ok(manifests)), accessStatus },
  });
  renderWithApp({ api: mock });
  return mock;
}

describe('AccessStatusChip', () => {
  it('waiting: "ParkStay queue · position 123 · about 4 min"', async () => {
    renderTray(status('waiting', { position: 123, etaSeconds: 240 }));
    await waitFor(() =>
      expect(chip()).toHaveTextContent('ParkStay queue · position 123 · about 4 min')
    );
  });

  it('active: "ParkStay · access granted · 12 min left", counting down', async () => {
    renderTray(status('active', { expiresAt: new Date(Date.now() + 12 * 60_000).toISOString() }));
    await waitFor(() =>
      expect(chip()).toHaveTextContent('ParkStay · access granted · 12 min left')
    );
    expect(within(chip() as HTMLElement).getByRole('timer')).toHaveTextContent('12 min');
  });

  it.each([
    ['expired', 'ParkStay queue session expired'],
    ['error', 'ParkStay queue status unavailable'],
  ] as const)('%s: "%s", collapsed', async (state, text) => {
    renderTray(status(state));
    await waitFor(() => expect(chip()).toHaveTextContent(text));
    expect(
      within(chip() as HTMLElement).getByRole('button', { name: 'ParkStay queue details' })
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('idle shows no chip, and nothing is fetched again: changes arrive as events', async () => {
    const mock = renderTray(status('idle'));
    await screen.findByRole('heading', { level: 1, name: 'Explore places to stay' });
    await waitFor(() => expect(mock.api.providers.accessStatus).toHaveBeenCalledTimes(1));
    expect(chip()).toBeNull();

    mock.emit('provider:access-status', status('waiting', { position: 40 }));
    await waitFor(() => expect(chip()).toHaveTextContent('ParkStay queue · position 40'));
    mock.emit('provider:access-status', status('idle'));
    await waitFor(() => expect(chip()).toBeNull());
    expect(mock.api.providers.accessStatus).toHaveBeenCalledTimes(1);
  });

  it('expands to say more, in the provider time zone', async () => {
    const mock = renderTray(status('idle'));
    await waitFor(() => expect(mock.api.providers.accessStatus).toHaveBeenCalled());
    mock.emit(
      'provider:access-status',
      status('active', {
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        message: 'Session refreshed',
      })
    );
    const details = await waitFor(() =>
      within(chip() as HTMLElement).getByRole('button', { name: 'ParkStay queue details' })
    );
    expect(screen.queryByText('Session refreshed')).not.toBeVisible();
    details.click();
    await waitFor(() => expect(details).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByText('Session refreshed')).toBeVisible();
    expect(screen.getByText(/^WA Stay can use ParkStay until .* AWST\.$/)).toBeVisible();
  });

  it('announces waiting → access granted, and a new position at most once a minute', async () => {
    let now = Date.parse('2026-10-09T07:00:00Z');
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const mock = renderTray(status('idle'));
      await waitFor(() => expect(mock.api.providers.accessStatus).toHaveBeenCalled());

      mock.emit('provider:access-status', status('waiting', { position: 120 }));
      await waitFor(() =>
        expect(politeRegion()).toHaveTextContent('ParkStay queue · position 120')
      );

      now += 20_000;
      mock.emit('provider:access-status', status('waiting', { position: 110 }));
      await waitFor(() => expect(chip()).toHaveTextContent('position 110'));
      expect(politeRegion()).toHaveTextContent('ParkStay queue · position 120');

      now += 45_000;
      mock.emit('provider:access-status', status('waiting', { position: 90 }));
      await waitFor(() => expect(politeRegion()).toHaveTextContent('ParkStay queue · position 90'));

      now += 1_000;
      mock.emit('provider:access-status', status('active'));
      await waitFor(() => expect(politeRegion()).toHaveTextContent('ParkStay · access granted'));
    } finally {
      clock.mockRestore();
    }
  });

  it('gives each provider with a gate its own chip, and none to a provider without one', async () => {
    const mock = renderTray(status('waiting', { position: 5 }), [
      PARKSTAY_MANIFEST,
      FAKE_GATED,
      NO_GATE,
    ]);
    await waitFor(() => expect(chip()).toBeInTheDocument());
    await waitFor(() => expect(mock.api.providers.accessStatus).toHaveBeenCalledTimes(2));
    mock.emit('provider:access-status', status('expired', {}, 'fake'));

    await waitFor(() => expect(chip('Fake queue')).toHaveTextContent('Fake queue session expired'));
    expect(chip('ParkStay queue')).toHaveTextContent('ParkStay queue · position 5');
    expect(mock.api.providers.accessStatus).toHaveBeenCalledTimes(2);
    expect(mock.api.providers.accessStatus).not.toHaveBeenCalledWith('nogate');
  });

  it('a status that cannot be read shows no chip and raises nothing', async () => {
    const mock = createMockApi({
      providers: { accessStatus: jest.fn().mockResolvedValue(fail('Gate gone', 'NOT_FOUND')) },
    });
    renderWithApp({ api: mock });
    await waitFor(() => expect(mock.api.providers.accessStatus).toHaveBeenCalled());
    expect(chip()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
