/**
 * The whole create-watch flow in the app (U1), against the mock API with two providers:
 * provider → location → stay → alerts → review → the new watch's page.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { nightsBetween, todayIn } from '../../../src/shared/utils/calendar-date';
import type { WatchInput } from '../../../src/shared/types/watch.types';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST, ok } from '../../utils/renderer/createMockApi';
import { currentRoute, renderWithApp } from '../../utils/renderer/renderWithApp';
import { makeLocation, makeWatch } from '../../fixtures/renderer/watches';

const LUCKY = makeLocation({
  providerId: 'fakestay',
  externalId: 'lb',
  name: 'Lucky Bay Holiday Park',
  kind: 'holiday-park',
  area: { name: 'Esperance', region: 'Golden Outback' },
});

describe('create a watch, end to end', () => {
  it('creates a Fake Stay watch: provider → location → stay → alerts → review → detail', async () => {
    const search = jest.fn().mockResolvedValue(ok({ items: [LUCKY], total: 1 }));
    const create = jest.fn((input: WatchInput) =>
      Promise.resolve(
        ok(
          makeWatch({
            id: 9,
            providerId: input.providerId,
            name: input.name,
            location: input.location,
            stay: { ...makeWatch().stay, ...input.stay },
          })
        )
      )
    );
    const get = jest.fn(() =>
      Promise.resolve(ok(create.mock.results[0] ? makeWatchFrom(create) : null))
    );
    const { user } = renderWithApp({
      route: '/watches',
      api: {
        providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST, FAKE_MANIFEST])) },
        catalog: {
          search,
          status: jest.fn().mockResolvedValue(
            ok({
              providers: [
                { providerId: 'parkstay', count: 6, stale: false, syncing: false },
                { providerId: 'fakestay', count: 3, stale: false, syncing: false },
              ],
            })
          ),
        },
        watches: { list: jest.fn().mockResolvedValue(ok([])), create, get },
        accounts: { list: jest.fn().mockResolvedValue(ok([])) },
      },
    });

    // From the list's empty state.
    await user.click(await screen.findByRole('link', { name: 'New watch' }));
    await screen.findByRole('heading', { level: 1, name: 'New watch' });

    // 1. Provider: both are offered; nothing is chosen for you.
    await user.click(await screen.findByRole('radio', { name: 'Fake Stay Holidays' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // 2. Location, searched in Fake Stay only.
    const location = await screen.findByRole('combobox', { name: 'Location' });
    await user.type(location, 'Lucky');
    await user.click(await screen.findByRole('option', { name: /Lucky Bay Holiday Park/ }));
    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'Lucky', providerIds: ['fakestay'] })
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // 3. Stay: two nights from the calendar, by keyboard.
    await screen.findByRole('heading', { level: 2, name: /Your stay$/ });
    expect(screen.queryByRole('combobox', { name: 'Camping with' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Dates/ }));
    await user.keyboard('{ArrowRight}{Enter}{ArrowRight}{ArrowRight}{Enter}');
    await user.click(
      within(screen.getByRole('dialog', { name: 'Choose dates' })).getByRole('button', {
        name: 'Done',
      })
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // 4. Alerts: no automatic hold for a provider without holds.
    await screen.findByRole('heading', { level: 2, name: /Alerts$/ });
    expect(screen.queryByRole('checkbox', { name: /automatically when found/ })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Alert on partial availability' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // 5. Review, then create.
    await screen.findByRole('heading', { level: 2, name: /Review$/ });
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toMatch(
      /^Lucky Bay Holiday Park · /
    );
    await user.click(screen.getByRole('button', { name: 'Create watch' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const input = create.mock.calls[0][0];
    expect(input).toMatchObject({
      providerId: 'fakestay',
      location: { externalId: 'lb', name: 'Lucky Bay Holiday Park', areaName: 'Esperance' },
      allowPartialMatch: true,
      notifyOnly: true,
      checkIntervalMinutes: 60,
    });
    expect(input).not.toHaveProperty('autoHold');
    expect(input.stay.arrival > todayIn('Australia/Perth')).toBe(true);
    expect(nightsBetween(input.stay.arrival, input.stay.departure)).toBe(2);

    await waitFor(() => expect(currentRoute()).toBe('/watches/9'));
    expect(await screen.findByRole('heading', { level: 1, name: input.name })).toBeInTheDocument();
  });
});

function makeWatchFrom(create: jest.Mock) {
  const input: WatchInput = create.mock.calls[0][0];
  return makeWatch({
    id: 9,
    providerId: input.providerId,
    name: input.name,
    location: input.location,
    stay: { ...makeWatch().stay, ...input.stay },
  });
}
