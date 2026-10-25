/**
 * A place whose provider has a notice the person has not accepted (§12.37): Check availability
 * opens the notice first and asks nothing; Not now leaves the card as it was; Continue accepts
 * and then checks. A check main refuses (`NOTICE_REQUIRED`: withdrawn meanwhile) says why and
 * offers the notice, and accepting asks the check again.
 */
import { configure, screen, waitFor, within } from '@testing-library/react';
import { availabilityFor, placeDetail } from '../../../../tests/fixtures/catalog/place-detail';
import { placeApi } from '../../../../tests/utils/renderer/catalog';
import { fail, ok, ROTTNEST_MANIFEST } from '../../../../tests/utils/renderer/createMockApi';
import { renderWithApp } from '../../../../tests/utils/renderer/renderWithApp';
import type { StayQuery } from '../../../shared/types/provider.types';

configure({ asyncUtilTimeout: 4000 });

const STAY = '?arrival=2099-11-06&departure=2099-11-08&adults=2';
const NOTICE = ROTTNEST_MANIFEST.notice!;
const REFUSED = "Read and accept Stay Rottnest's notice in WA Stay first.";
const UNITS = [
  { unitId: 'GPV04', unitName: 'Geordie Bay Premium View - 4 Beds', unitKind: 'cabin' as const },
  { unitId: 'GPV06', unitName: 'Geordie Bay Premium View - 6 Beds', unitKind: 'cabin' as const },
];
const GEORDIE = placeDetail({
  key: 'rottnest:geordie-bay',
  providerId: 'rottnest',
  externalId: 'geordie-bay',
  name: 'Geordie Bay',
  kind: 'cabin',
  imageUrls: [],
  units: UNITS,
  unitCount: 2,
  unitsAreTypes: true,
  releaseInfo: undefined,
});

function setup({ accepted = false, refuse = false } = {}) {
  let isAccepted = accepted;
  let refusing = refuse;
  const status = () => ({
    providerId: 'rottnest',
    required: true,
    accepted: isAccepted,
    version: 1,
  });
  const notice = jest.fn(async () => ok(status()));
  const acceptNotice = jest.fn(async () => {
    isAccepted = true;
    refusing = false;
    return ok({ ...status(), acceptedAt: '2026-10-18T02:00:00.000Z' });
  });
  const checkLocation = jest.fn(async (_key: string, stay: StayQuery) =>
    refusing
      ? fail(REFUSED, 'NOTICE_REQUIRED')
      : ok({ ...availabilityFor(stay, { fully: 1, partly: 0 }, UNITS), key: GEORDIE.key })
  );
  const api = placeApi({
    detail: GEORDIE,
    items: [GEORDIE],
    catalog: { checkLocation },
    stubs: {
      providers: {
        list: jest.fn().mockResolvedValue(ok([ROTTNEST_MANIFEST])),
        notice,
        acceptNotice,
      },
    },
  });
  return {
    ...renderWithApp({ route: `/places/rottnest/geordie-bay${STAY}`, api }),
    notice,
    acceptNotice,
    checkLocation,
  };
}

const card = () => screen.getByRole('region', { name: 'Check your dates' });
const checkButton = () => within(card()).getByRole('button', { name: 'Check availability' });
const dialog = () => screen.getByRole('dialog', { name: NOTICE.title });

async function ready(notice: jest.Mock) {
  await screen.findByRole('heading', { level: 1, name: 'Geordie Bay' });
  await waitFor(() => expect(notice).toHaveBeenCalledWith('rottnest'));
}

describe('Place page: a provider with a notice', () => {
  it('Check availability opens the notice first, and asks nothing until it is accepted', async () => {
    const { user, notice, checkLocation, acceptNotice } = setup();
    await ready(notice);

    await user.click(checkButton());
    expect(dialog()).toBeVisible();
    expect(checkLocation).not.toHaveBeenCalled();

    await user.click(within(dialog()).getByRole('checkbox', { name: NOTICE.confirmLabel }));
    await user.click(within(dialog()).getByRole('button', { name: 'Continue' }));

    const section = await screen.findByRole('region', { name: 'Availability' });
    expect(section).toBeVisible();
    expect(acceptNotice).toHaveBeenCalledWith('rottnest', 1);
    expect(checkLocation).toHaveBeenCalledTimes(1);
    expect(checkLocation).toHaveBeenCalledWith('rottnest:geordie-bay', expect.anything());
  });

  it('Not now closes the notice and checks nothing', async () => {
    const { user, notice, checkLocation, acceptNotice } = setup();
    await ready(notice);
    await user.click(checkButton());
    await user.click(within(dialog()).getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(checkLocation).not.toHaveBeenCalled();
    expect(acceptNotice).not.toHaveBeenCalled();
    expect(checkButton()).toBeEnabled();
  });

  it('once accepted, Check availability checks at once', async () => {
    const { user, notice, checkLocation } = setup({ accepted: true });
    await ready(notice);
    await user.click(checkButton());
    expect(await screen.findByRole('region', { name: 'Availability' })).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(checkLocation).toHaveBeenCalledTimes(1);
  });

  it('a check main refuses says why, offers the notice, and accepting asks it again', async () => {
    const { user, notice, checkLocation } = setup({ accepted: true, refuse: true });
    await ready(notice);
    await user.click(checkButton());

    const line = await within(card()).findByText("Read Stay Rottnest's notice to check dates.");
    expect(line.closest('[role="status"]')).not.toBeNull();
    expect(within(card()).queryByRole('alert')).toBeNull();

    await user.click(within(card()).getByRole('button', { name: 'Read the notice' }));
    await user.click(within(dialog()).getByRole('checkbox', { name: NOTICE.confirmLabel }));
    await user.click(within(dialog()).getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('region', { name: 'Availability' })).toBeVisible();
    expect(checkLocation).toHaveBeenCalledTimes(2);
  });
});
