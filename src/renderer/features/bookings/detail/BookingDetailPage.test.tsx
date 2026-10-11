import { screen, waitFor, within } from '@testing-library/react';
import type { Booking } from '../../../../shared/types/booking.types';
import { PARKSTAY_MANIFEST, fail, ok } from '@tests/utils/renderer/createMockApi';
import { makeBooking, makeLegacyBooking } from '@tests/fixtures/renderer/bookings';
import { catalogGet, makeLocationDetail } from '@tests/fixtures/renderer/watches';
import { currentRoute, renderWithApp } from '@tests/utils/renderer/renderWithApp';
import { politeAnnouncement } from '@tests/utils/renderer/renderWithProviders';

const PHOTO = 'https://parkstay.dbca.wa.gov.au/media/osprey.jpg';
const OSPREY = makeBooking({
  id: 1,
  totalCost: 105,
  stayParams: { gearType: 'tent' },
  notes: 'Site faces the water',
});

function setup(
  booking: Booking | null = OSPREY,
  extra: Record<string, Record<string, jest.Mock>> = {}
) {
  const get = catalogGet(makeLocationDetail({ imageUrls: [PHOTO] }));
  const result = renderWithApp({
    route: '/bookings/1',
    api: {
      providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST])) },
      catalog: { get },
      ...extra,
      bookings: {
        get: jest.fn().mockResolvedValue(ok(booking)),
        list: jest.fn().mockResolvedValue(ok(booking ? [booking] : [])),
        ...extra.bookings,
      },
    },
  });
  return { ...result, catalogGetMock: get };
}

const page = () => screen.findByRole('heading', { level: 1, name: 'Osprey Bay' });
const section = (name: string) => screen.getByRole('region', { name });

describe('BookingDetailPage', () => {
  it('shows whose and where, the status, a link to the place and every section', async () => {
    setup();
    await page();
    expect(await screen.findByRole('img', { name: 'Osprey Bay' })).toHaveAttribute('src', PHOTO);
    expect(screen.getAllByRole('img', { name: 'ParkStay WA' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'About Osprey Bay' })).toHaveAttribute(
      'href',
      '#/places/parkstay/20'
    );
    expect(section('Stay')).toHaveTextContent('Check-inFri 11 Dec 2099');
    expect(section('Stay')).toHaveTextContent('Check-outSun 13 Dec 2099');
    expect(section('Stay')).toHaveTextContent('2 nights');
    await waitFor(() => expect(section('Unit')).toHaveTextContent('Site 12'));
    expect(section('Unit')).toHaveTextContent('Camping with: Tent');
    expect(section('Guests')).toHaveTextContent('2 adults');
    expect(section('Cost')).toHaveTextContent('$105.00');
    expect(section('Reference')).toHaveTextContent('PB123456');
    expect(section('Notes')).toHaveTextContent('Site faces the water');
  });

  it('hands off with "Manage on ParkStay", opening the manage URL in the browser', async () => {
    setup();
    await page();
    const manage = screen.getByRole('link', { name: 'Manage on ParkStay (opens in your browser)' });
    expect(manage.tagName).toBe('A');
    expect(manage).toHaveAttribute('href', 'https://parkstay.dbca.wa.gov.au/mybookings/');
    expect(manage).toHaveAttribute('target', '_blank');
    expect(manage).toHaveAttribute('rel', 'noopener noreferrer');
    expect(manage.querySelector('svg')).not.toBeNull();
  });

  it('offers no way to cancel at the provider, even in its menu', async () => {
    const { user } = setup();
    await page();
    await user.click(screen.getByRole('button', { name: 'More actions for Osprey Bay' }));
    const controls = [
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('link'),
      ...screen.getAllByRole('menuitem'),
    ];
    expect(controls.filter((c) => /cancel/i.test(c.textContent ?? ''))).toEqual([]);
  });

  it('removes the booking from WA Stay after confirming, then goes back to the list', async () => {
    const remove = jest.fn().mockResolvedValue(ok(true));
    const { user } = setup(OSPREY, { bookings: { delete: remove } });
    await page();
    await user.click(screen.getByRole('button', { name: 'More actions for Osprey Bay' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from WA Stay' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Remove Osprey Bay from WA Stay?' });
    expect(dialog).toHaveTextContent('It does not cancel it on ParkStay.');
    await user.click(within(dialog).getByRole('button', { name: 'Remove from WA Stay' }));

    await waitFor(() => expect(currentRoute()).toBe('/bookings'));
    expect(remove).toHaveBeenCalledWith(1);
    expect(
      within(screen.getByRole('region', { name: 'Notifications' })).getByText(
        'Removed Osprey Bay from WA Stay'
      )
    ).toBeInTheDocument();
  });

  it('names the copy button and announces a copy politely', async () => {
    const { user } = setup();
    await page();
    await user.click(screen.getByRole('button', { name: 'Copy reference PB123456' }));
    await expect(navigator.clipboard.readText()).resolves.toBe('PB123456');
    await waitFor(() => expect(politeAnnouncement()).toBe('Reference copied'));
  });

  it('selects the reference instead when there is no clipboard', async () => {
    const { user } = setup();
    await page();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Copy reference PB123456' }));
    expect(window.getSelection()?.toString()).toBe('PB123456');
    expect(within(section('Reference')).getByText('Press Ctrl+C to copy')).toBeVisible();
    await waitFor(() => expect(politeAnnouncement()).toBe('Press Ctrl+C to copy'));
  });

  it('shows an unknown provider as such, with no manage link', async () => {
    setup(makeBooking({ id: 1, providerId: 'gone', manageUrl: undefined }));
    await page();
    expect(screen.getByRole('img', { name: 'Unknown provider' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Manage on/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy reference PB123456' })).toBeInTheDocument();
  });

  it('has no manage link when there is neither a manage URL nor a website', async () => {
    renderWithApp({
      route: '/bookings/1',
      api: {
        providers: {
          list: jest.fn().mockResolvedValue(ok([{ ...PARKSTAY_MANIFEST, website: '' }])),
        },
        catalog: { get: catalogGet() },
        bookings: { get: jest.fn().mockResolvedValue(ok({ ...OSPREY, manageUrl: undefined })) },
      },
    });
    await page();
    expect(screen.queryByRole('link', { name: /^Manage on/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy reference PB123456' })).toBeInTheDocument();
  });

  it('shows no hero when the catalogue has no photo of the place', async () => {
    const get = catalogGet(makeLocationDetail({ imageUrls: [] }));
    renderWithApp({
      route: '/bookings/1',
      api: {
        providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST])) },
        catalog: { get },
        bookings: { get: jest.fn().mockResolvedValue(ok(OSPREY)) },
      },
    });
    await page();
    await waitFor(() => expect(get).toHaveBeenCalledWith('parkstay:20'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('img', { name: /Osprey Bay/ })).toBeNull();
  });

  it('leaves out Cost when it is unknown', async () => {
    setup(makeBooking({ id: 1 }));
    await page();
    expect(screen.queryByRole('region', { name: 'Cost' })).toBeNull();
  });

  it('formats a cost in another currency with that currency', async () => {
    setup(makeBooking({ id: 1, totalCost: 80, currency: 'USD' }));
    await page();
    expect(section('Cost').textContent).toMatch(/USD\s80\.00/);
  });

  it('shows a v6 booking with its campground and park, no photo and no place link', async () => {
    const { catalogGetMock } = setup(makeLegacyBooking({ id: 1 }));
    await screen.findByRole('heading', { level: 1, name: 'Dales Campground' });
    expect(screen.getByText('· Karijini National Park')).toBeInTheDocument();
    // No location id, so no photo can ever be found: no hero, rather than an empty one.
    expect(screen.queryByRole('img', { name: /Dales Campground/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^About/ })).toBeNull();
    expect(section('Unit')).toHaveTextContent('Site type: Unpowered');
    expect(catalogGetMock).not.toHaveBeenCalled();
  });

  it('says when the booking is not there', async () => {
    setup(null, {
      bookings: { get: jest.fn().mockResolvedValue(fail('No booking 1', 'NOT_FOUND')) },
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Booking not found' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to bookings' })).toHaveAttribute(
      'href',
      '#/bookings'
    );
  });
});
