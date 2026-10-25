/**
 * The create-watch flow with a provider whose notice is not accepted (§12.37): Continue on the
 * provider step opens the notice, and the flow goes on once it is accepted; Not now stays on
 * the step. A create main refuses (`NOTICE_REQUIRED`: withdrawn meanwhile) opens the notice,
 * and accepting creates the watch.
 */
import { screen, waitFor, within } from '@testing-library/react';
import {
  ok,
  fail,
  PARKSTAY_MANIFEST,
  ROTTNEST_MANIFEST,
} from '@tests/utils/renderer/createMockApi';
import {
  catalogGet,
  makeLocation,
  makeLocationDetail,
  makeWatch,
} from '@tests/fixtures/renderer/watches';
import { currentRoute, renderWithApp } from '@tests/utils/renderer/renderWithApp';

const NOTICE = ROTTNEST_MANIFEST.notice!;
const REFUSED = "Read and accept Stay Rottnest's notice in WA Stay first.";
const GEORDIE = makeLocation({
  providerId: 'rottnest',
  externalId: 'geordie-bay',
  name: 'Geordie Bay',
  kind: 'cabin',
  area: { name: 'Rottnest Island', region: 'Swan' },
  unitKinds: ['cabin'],
  unitCount: 2,
});
const PREFILL =
  '/watches/new?provider=rottnest&location=geordie-bay&arrival=2099-12-11&departure=2099-12-13&adults=2';

function api({ accepted = false, create = jest.fn() } = {}) {
  let isAccepted = accepted;
  const status = () => ({
    providerId: 'rottnest',
    required: true,
    accepted: isAccepted,
    version: 1,
  });
  const created = makeWatch({ id: 42, providerId: 'rottnest' });
  if (!create.getMockImplementation()) create.mockResolvedValue(ok(created));
  return {
    providers: {
      list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST, ROTTNEST_MANIFEST])),
      notice: jest.fn(async () => ok(status())),
      acceptNotice: jest.fn(async () => {
        isAccepted = true;
        return ok({ ...status(), acceptedAt: '2026-10-18T02:00:00.000Z' });
      }),
    },
    catalog: {
      get: catalogGet(
        makeLocationDetail({
          ...GEORDIE,
          units: [
            { unitId: 'GPV04', unitName: 'Geordie Bay Premium View - 4 Beds', unitKind: 'cabin' },
          ],
        })
      ),
      search: jest.fn().mockResolvedValue(ok({ items: [GEORDIE], total: 1 })),
      status: jest
        .fn()
        .mockResolvedValue(
          ok({ providers: [{ providerId: 'rottnest', count: 9, stale: false, syncing: false }] })
        ),
    },
    watches: {
      list: jest.fn().mockResolvedValue(ok([])),
      create,
      get: jest.fn().mockResolvedValue(ok(created)),
    },
  };
}

const button = (name: string) => screen.getByRole('button', { name });
const dialog = () => screen.getByRole('dialog', { name: NOTICE.title });
async function accept(user: ReturnType<typeof renderWithApp>['user']) {
  await user.click(within(dialog()).getByRole('checkbox', { name: NOTICE.confirmLabel }));
  await user.click(within(dialog()).getByRole('button', { name: 'Continue' }));
}

describe('NewWatchPage: a provider with a notice', () => {
  it('Continue on the provider step opens the notice; accepting goes on to Location', async () => {
    const mock = api();
    const { user } = renderWithApp({ route: '/watches/new', api: mock });
    await user.click(await screen.findByRole('radio', { name: 'Stay Rottnest' }));
    await waitFor(() => expect(mock.providers.notice).toHaveBeenCalledWith('rottnest'));

    await user.click(button('Continue'));
    expect(dialog()).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: /Booking site$/ })).toBeInTheDocument();

    await accept(user);
    expect(await screen.findByRole('heading', { level: 2, name: /Location$/ })).toBeInTheDocument();
    expect(mock.providers.acceptNotice).toHaveBeenCalledWith('rottnest', 1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Not now stays on the provider step', async () => {
    const mock = api();
    const { user } = renderWithApp({ route: '/watches/new', api: mock });
    await user.click(await screen.findByRole('radio', { name: 'Stay Rottnest' }));
    await waitFor(() => expect(mock.providers.notice).toHaveBeenCalled());
    await user.click(button('Continue'));
    await user.click(within(dialog()).getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: /Booking site$/ })).toBeInTheDocument();
    expect(mock.providers.acceptNotice).not.toHaveBeenCalled();
  });

  it('ParkStay, with no notice, goes straight on and asks for none', async () => {
    const mock = api();
    const { user } = renderWithApp({ route: '/watches/new', api: mock });
    await user.click(await screen.findByRole('radio', { name: 'ParkStay WA' }));
    await user.click(button('Continue'));
    expect(await screen.findByRole('heading', { level: 2, name: /Location$/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mock.providers.notice).not.toHaveBeenCalled();
  });

  it('a create main refuses opens the notice, and accepting creates the watch', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce(fail(REFUSED, 'NOTICE_REQUIRED'))
      .mockResolvedValue(ok(makeWatch({ id: 42, providerId: 'rottnest' })));
    // Its status read as accepted when the flow opened, then was withdrawn elsewhere
    const mock = api({ accepted: true, create });
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    await screen.findByRole('heading', { level: 2, name: /Your stay$/ });
    await user.click(button('Continue'));
    await screen.findByRole('heading', { level: 2, name: /Alerts$/ });
    await user.click(button('Continue'));
    await screen.findByRole('heading', { level: 2, name: /Review$/ });
    await user.click(button('Create watch'));

    await waitFor(() => expect(dialog()).toBeVisible());
    expect(create).toHaveBeenCalledTimes(1);
    await accept(user);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(currentRoute()).toBe('/watches/42'));
  });
});
