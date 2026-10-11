/**
 * The whole Site Sniper journey in the app (U2), against the mock API: provider → location →
 * stay → release → review → the new snipe's page; then main pushes the hold (`snipe:updated`)
 * and "Pay now" opens the payment window through `snipes.openPayment`. No live hold is ever
 * placed (§12.33): the held state comes from a pushed event.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { SnipeStatus } from '../../../src/shared/types/common.types';
import type { SiteSnipe, SiteSnipeInput } from '../../../src/shared/types/site-sniper.types';
import { nightsBetween } from '../../../src/shared/utils/calendar-date';
import { makeSnipe, snipeFlowApi } from '../../fixtures/renderer/snipes';
import { createMockApi, ok } from '../../utils/renderer/createMockApi';
import { currentRoute, renderWithApp } from '../../utils/renderer/renderWithApp';

describe('create a snipe, end to end', () => {
  it('creates a ParkStay snipe, then pays for the hold main pushes', async () => {
    let stored: SiteSnipe | null = null;
    const create = jest.fn((input: SiteSnipeInput) => {
      stored = makeSnipe({
        id: 9,
        name: input.name,
        location: { ...input.location, name: input.location.name },
        stay: { ...makeSnipe().stay, ...input.stay },
        releaseMode: input.releaseMode,
        accessGateEnabled: input.accessGateEnabled ?? false,
      });
      return Promise.resolve(ok(stored));
    });
    const openPayment = jest.fn().mockResolvedValue(ok(undefined));
    const get = jest.fn(() => Promise.resolve(ok(stored)));
    const list = jest.fn(() => Promise.resolve(ok(stored ? [stored] : [])));
    const mock = createMockApi(snipeFlowApi({ snipes: { list, create, get, openPayment } }));
    const { user } = renderWithApp({ route: '/site-sniper', api: mock });

    // From the list's empty state.
    await user.click(await screen.findByRole('link', { name: 'New snipe' }));
    await screen.findByRole('heading', { level: 1, name: 'New snipe' });

    // 1. Provider: the only one with Site Sniper, chosen for you but shown.
    await waitFor(() => expect(screen.getByRole('radio', { name: 'ParkStay WA' })).toBeChecked());
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // 2. Location, searched in ParkStay.
    await user.type(await screen.findByRole('combobox', { name: 'Location' }), 'Osp');
    await user.click(await screen.findByRole('option', { name: /Osprey Bay/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // 3. Stay: two nights from the calendar, by keyboard; one preferred site.
    await screen.findByRole('heading', { level: 2, name: /Your stay$/ });
    await user.click(screen.getByRole('button', { name: /^Dates/ }));
    await user.keyboard('{ArrowRight}{Enter}{ArrowRight}{ArrowRight}{Enter}');
    await user.click(
      within(screen.getByRole('dialog', { name: 'Choose dates' })).getByRole('button', {
        name: 'Done',
      })
    );
    await user.click(await screen.findByRole('button', { name: 'Choose sites' }));
    await user.click(screen.getByRole('checkbox', { name: 'Site 2' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // 4. Release: the provider's modes, rollover first.
    await screen.findByRole('heading', { level: 2, name: /Release and timing$/ });
    expect(screen.getByRole('radio', { name: 'When new dates open' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // 5. Review, then create.
    await screen.findByRole('heading', { level: 2, name: /Review$/ });
    await user.click(screen.getByRole('button', { name: 'Create snipe' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const input = create.mock.calls[0][0];
    expect(input).toMatchObject({
      providerId: 'parkstay',
      location: { externalId: '20', name: 'Osprey Bay' },
      unitIds: ['2'],
      releaseMode: 'daily_rollover',
      pollIntervalMs: 1500,
    });
    expect(nightsBetween(input.stay.arrival, input.stay.departure)).toBe(2);

    // The new snipe's page.
    await waitFor(() => expect(currentRoute()).toBe('/site-sniper/9'));
    expect(await screen.findByRole('heading', { level: 1, name: input.name })).toBeInTheDocument();

    // Main holds a site: the page shows it at once, announces it, and Pay now opens payment.
    const held = {
      ...(stored as unknown as SiteSnipe),
      status: SnipeStatus.HELD,
      isActive: false,
      holdReference: '2072968',
      holdExpiresAt: new Date(Date.now() + 29 * 60_000),
      holdUnitId: '2',
    };
    stored = held;
    mock.emit('snipe:updated', held);
    const hold = await screen.findByRole('region', { name: 'Hold at Osprey Bay' });
    expect(screen.getByRole('alert')).toHaveTextContent(
      /^Site held at Osprey Bay\. Pay within (29|30) minutes\.$/
    );
    await user.click(within(hold).getByRole('button', { name: 'Pay now' }));
    expect(openPayment).toHaveBeenCalledWith(9);
  });
});
