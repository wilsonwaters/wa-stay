import { screen, within } from '@testing-library/react';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST, ok } from '@tests/utils/renderer/createMockApi';
import { catalogGet, makeLocation, makeLocationDetail } from '@tests/fixtures/renderer/watches';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

function api(items = [makeLocation()], syncing = false) {
  return {
    providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST, FAKE_MANIFEST])) },
    catalog: {
      get: catalogGet(),
      search: jest.fn().mockResolvedValue(ok({ items, total: items.length })),
      status: jest.fn().mockResolvedValue(
        ok({
          providers: [{ providerId: 'parkstay', count: syncing ? 0 : 6, stale: false, syncing }],
        })
      ),
    },
    watches: { list: jest.fn().mockResolvedValue(ok([])) },
    accounts: { list: jest.fn().mockResolvedValue(ok([])) },
  };
}

const stepList = () => screen.getByRole('navigation', { name: 'New watch steps' });

describe('NewWatchPage prefill (§12.10)', () => {
  it('opens on Your stay with provider, location, dates and guests filled', async () => {
    const mock = api();
    const { user } = renderWithApp({
      route:
        '/watches/new?provider=parkstay&location=20&arrival=2099-12-12&departure=2099-12-14&adults=2',
      api: mock,
    });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Step 3 of 5: Your stay' })
    ).toBeInTheDocument();
    expect(within(stepList()).getByRole('button', { name: 'Provider, done' })).toBeInTheDocument();
    expect(within(stepList()).getByRole('button', { name: 'Location, done' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dates Sat 12 – Mon 14 Dec' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Guests 2 adults/ })).toBeInTheDocument();
    expect(mock.catalog.get).toHaveBeenCalledWith('parkstay:20');
    expect(screen.queryByText("Some of the link couldn't be used")).toBeNull();

    await user.click(within(stepList()).getByRole('button', { name: 'Location, done' }));
    expect(await screen.findByRole('combobox', { name: 'Location' })).toHaveValue('Osprey Bay');
  });

  it('accepts the old /watches/create address through the redirect', async () => {
    renderWithApp({ route: '/watches/create?provider=parkstay&location=20', api: api() });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Step 3 of 5: Your stay' })
    ).toBeInTheDocument();
  });

  it('drops what it cannot use and says so, opening on the first step left to do', async () => {
    renderWithApp({
      route: '/watches/new?provider=parkstay&location=999&arrival=2000-01-01&departure=2000-01-03',
      api: api(),
    });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Step 2 of 5: Location' })
    ).toBeInTheDocument();
    const notice = screen.getByText("Some of the link couldn't be used").closest('[role="status"]');
    expect(notice).toHaveTextContent(/dates couldn't be used/);
    expect(notice).toHaveTextContent(/place couldn't be found/);
    expect(screen.getByRole('combobox', { name: 'Location' })).toHaveValue('');
  });

  it('opens on the provider step for a provider it cannot watch', async () => {
    renderWithApp({ route: '/watches/new?provider=rac&location=9', api: api() });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Step 1 of 5: Provider' })
    ).toBeInTheDocument();
    expect(screen.getByText(/provider isn't available/)).toBeInTheDocument();
  });

  it('names the place from its detail and offers its units on Your stay', async () => {
    const mock = api();
    const { user } = renderWithApp({
      route: '/watches/new?provider=parkstay&location=20&arrival=2099-12-12&departure=2099-12-14',
      api: mock,
    });
    await screen.findByRole('heading', { level: 2, name: 'Step 3 of 5: Your stay' });
    expect(mock.catalog.get).toHaveBeenCalledWith('parkstay:20');
    expect(mock.catalog.search).not.toHaveBeenCalled();
    expect(await screen.findByText('Preferred sites')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose sites' }));
    await user.click(screen.getByRole('checkbox', { name: 'All Powered (4)' }));
    expect(screen.getByText(/4 sites chosen/)).toBeInTheDocument();
  });

  it('shows the chosen place’s photo from its detail, on Location and in the review', async () => {
    const mock = api();
    mock.catalog.get = catalogGet(makeLocationDetail({ imageUrls: [PHOTO] }));
    const { user } = renderWithApp({
      route: '/watches/new?provider=parkstay&location=20&arrival=2099-12-12&departure=2099-12-14',
      api: mock,
    });
    await screen.findByRole('heading', { level: 2, name: 'Step 3 of 5: Your stay' });
    await user.click(within(stepList()).getByRole('button', { name: 'Location, done' }));
    expect(await screen.findByRole('img', { name: 'Osprey Bay' })).toHaveAttribute('src', PHOTO);
    for (const next of ['Your stay', 'Alerts', 'Review']) {
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await screen.findByRole('heading', { level: 2, name: new RegExp(`${next}$`) });
    }
    const where = await screen.findByRole('region', { name: 'Where' });
    expect(within(where).getByRole('img', { name: 'Osprey Bay' })).toHaveAttribute('src', PHOTO);
  });
});

const PHOTO = 'https://example.org/osprey.jpg';
