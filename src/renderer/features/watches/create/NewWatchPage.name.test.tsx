import { screen, waitFor, within } from '@testing-library/react';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST, ok } from '@tests/utils/renderer/createMockApi';
import { catalogGet, makeLocation } from '@tests/fixtures/renderer/watches';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

function api() {
  return {
    providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST, FAKE_MANIFEST])) },
    catalog: {
      get: catalogGet(),
      search: jest.fn().mockResolvedValue(ok({ items: [makeLocation()], total: 1 })),
      status: jest
        .fn()
        .mockResolvedValue(
          ok({ providers: [{ providerId: 'parkstay', count: 6, stale: false, syncing: false }] })
        ),
    },
    watches: { list: jest.fn().mockResolvedValue(ok([])) },
    accounts: { list: jest.fn().mockResolvedValue(ok([])) },
  };
}

const button = (name: string) => screen.getByRole('button', { name });
const SUGGESTED = /^Osprey Bay · .+ – .+/;

describe('NewWatchPage name', () => {
  it('suggests a name until the person writes their own, and again once it is cleared', async () => {
    const { user } = renderWithApp({
      route: '/watches/new?provider=parkstay&location=20',
      api: api(),
    });
    /** Chooses dates on Your stay by keyboard, then goes on to the review's Name field. */
    const chooseDates = async (keys: string) => {
      await screen.findByRole('heading', { level: 2, name: /Your stay$/ });
      await user.click(screen.getByRole('button', { name: /^Dates/ }));
      await user.keyboard(keys);
      const picker = screen.getByRole('dialog', { name: 'Choose dates' });
      await user.click(within(picker).getByRole('button', { name: 'Done' }));
      await user.click(button('Continue'));
      await screen.findByRole('heading', { level: 2, name: /Alerts$/ });
      await user.click(button('Continue'));
      await screen.findByRole('heading', { level: 2, name: /Review$/ });
      return screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' });
    };

    // The place's name first, then the dates join it.
    const name = await chooseDates('{ArrowRight}{Enter}{ArrowRight}{ArrowRight}{Enter}');
    const suggested = name.value;
    expect(suggested).toMatch(SUGGESTED);

    // The person's own name stays when the dates change.
    await user.tripleClick(name);
    await user.keyboard('Our trip');
    expect(name).toHaveValue('Our trip');
    await user.click(button('Back'));
    await user.click(button('Back'));
    const again = await chooseDates('{ArrowRight}{ArrowRight}{Enter}{ArrowRight}{Enter}');
    expect(again).toHaveValue('Our trip');

    // Cleared, it is suggested again, from the new dates.
    await user.clear(again);
    await waitFor(() => expect(again.value).toMatch(SUGGESTED));
    expect(again).not.toHaveValue(suggested);
  });
});
