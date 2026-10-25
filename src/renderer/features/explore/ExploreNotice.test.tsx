/**
 * Explore with dates and a provider whose notice is not accepted (§12.37): main does not ask
 * it, and says so (`notice`); Explore offers the notice once, above the list, its cards say
 * why they have no count, and accepting asks that provider again, and no other.
 */
import { configure, screen, waitFor, within } from '@testing-library/react';
import { catalogApi, placeNamed } from '../../../../tests/utils/renderer/catalog';
import { ok, PARKSTAY_MANIFEST } from '../../../../tests/utils/renderer/createMockApi';
import { installFakeMap } from '../../../../tests/utils/renderer/fakeMapController';
import { ROTTNEST_MANIFEST } from '../../../../tests/utils/renderer/manifests';
import { renderWithApp } from '../../../../tests/utils/renderer/renderWithApp';
import type { LocationSummary } from '../../../shared/types/catalog.types';
import type { StayQuery } from '../../../shared/types/provider.types';
import { createMapboxController } from './map/mapboxController';

configure({ asyncUtilTimeout: 4000 });

jest.mock('./map/mapSupport', () => ({
  detectMapSupport: () => ({ available: false, reason: 'no-token' }),
}));
jest.mock('./map/mapboxController', () => ({ createMapboxController: jest.fn() }));

const YARDIE = placeNamed('Yardie Creek');
const GEORDIE: LocationSummary = {
  key: 'rottnest:geordie-bay',
  providerId: 'rottnest',
  externalId: 'geordie-bay',
  name: 'Geordie Bay',
  kind: 'cabin',
  bookingMode: 'online',
  lat: -31.9909,
  lng: 115.5227,
  area: { name: 'Rottnest Island', region: 'Swan' },
  imageUrls: [],
  amenities: [],
  unitKinds: ['cabin'],
};
const STAY = 'arrival=2099-11-06&departure=2099-11-08&adults=2';
const MESSAGE = "Read and accept Stay Rottnest's notice in WA Stay first.";
const NOTICE = ROTTNEST_MANIFEST.notice!;

function setup() {
  let accepted = false;
  const availability = jest.fn(async (_stay: StayQuery, options: { providerIds?: string[] }) => {
    const [id] = options.providerIds ?? [];
    if (id === 'rottnest') {
      return ok(
        accepted
          ? { entries: [{ key: GEORDIE.key, availableUnits: 3 }], errors: [] }
          : { entries: [], errors: [{ providerId: 'rottnest', code: 'notice', message: MESSAGE }] }
      );
    }
    return ok({ entries: [{ key: YARDIE.key, availableUnits: 9, bookableUnits: 10 }], errors: [] });
  });
  const status = () => ({ providerId: 'rottnest', required: true, accepted, version: 1 });
  const notice = jest.fn(async () => ok(status()));
  const acceptNotice = jest.fn(async () => {
    accepted = true;
    return ok({ ...status(), acceptedAt: '2026-10-18T02:00:00.000Z' });
  });
  const stubs = catalogApi({
    items: [YARDIE, GEORDIE],
    catalog: { availability },
    stubs: {
      providers: {
        list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST, ROTTNEST_MANIFEST])),
        notice,
        acceptNotice,
      },
    },
  });
  return { ...renderWithApp({ route: `/?${STAY}`, api: stubs }), availability, acceptNotice };
}

beforeEach(() => {
  installFakeMap(jest.mocked(createMapboxController));
  Element.prototype.scrollIntoView = jest.fn();
});

const results = () => screen.getByRole('region', { name: 'Results' });
const card = (name: string) => within(results()).getByRole('link', { name });

describe('Explore: a provider whose notice is not accepted', () => {
  it('offers the notice once, calmly; its cards say why they have no count; the others count as usual', async () => {
    setup();
    const offer = await screen.findByText(
      "Stay Rottnest checks dates once you've read and accepted its notice."
    );
    expect(offer.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      await within(card('Geordie Bay')).findByText("Read Stay Rottnest's notice to check dates")
    ).toBeInTheDocument();
    expect(within(card('Yardie Creek')).getByText('9 of 10 sites available')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: "Read Stay Rottnest's notice" })).toHaveLength(1);
  });

  it('accepting asks Stay Rottnest again, and no other provider, and its counts appear', async () => {
    const { user, availability, acceptNotice } = setup();
    await user.click(await screen.findByRole('button', { name: "Read Stay Rottnest's notice" }));
    const dialog = screen.getByRole('dialog', { name: NOTICE.title });
    availability.mockClear();

    await user.click(within(dialog).getByRole('checkbox', { name: NOTICE.confirmLabel }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));

    expect(await within(card('Geordie Bay')).findByText('3 cabins free')).toBeInTheDocument();
    expect(acceptNotice).toHaveBeenCalledWith('rottnest', 1);
    expect(availability).toHaveBeenCalledTimes(1);
    expect(availability).toHaveBeenCalledWith(expect.anything(), { providerIds: ['rottnest'] });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() =>
      expect(
        screen.queryByText("Stay Rottnest checks dates once you've read and accepted its notice.")
      ).toBeNull()
    );
  });

  it('Not now leaves everything as it was, and asks nothing', async () => {
    const { user, availability, acceptNotice } = setup();
    await user.click(await screen.findByRole('button', { name: "Read Stay Rottnest's notice" }));
    availability.mockClear();
    await user.click(
      within(screen.getByRole('dialog', { name: NOTICE.title })).getByRole('button', {
        name: 'Not now',
      })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      within(card('Geordie Bay')).getByText("Read Stay Rottnest's notice to check dates")
    ).toBeInTheDocument();
    expect(acceptNotice).not.toHaveBeenCalled();
    expect(availability).not.toHaveBeenCalled();
  });
});
