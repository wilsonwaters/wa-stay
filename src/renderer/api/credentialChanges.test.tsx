/**
 * A detail saved for a provider changed (R16): `account:updated` for a `credentials` account
 * (an RAC member number saved, replaced or removed) resets that provider's availability in the
 * renderer's cache, its bulk counts and its places' checks, since its prices, free nights and
 * release times depend on it. Another provider's answers stay, and so does everything for an
 * account change that is not one of saved details (a ParkStay sign-in).
 */
import { act } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { RAC_SAVED, account, racAccount } from '@tests/fixtures/renderer/settings';
import { createMockApi } from '@tests/utils/renderer/createMockApi';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { isAvailabilityOf, useCredentialChangeUpdates } from './accounts';
import { queryKeys } from './queryKeys';

const STAY = { arrival: '2026-11-06', departure: '2026-11-08', adults: 2 };
const KEYS = {
  racBulk: queryKeys.catalog.availability('2026-11-06_2026-11-08_2_0_0', 'rac'),
  racCheck: queryKeys.catalog.check('rac:busselton', STAY),
  parkstayBulk: queryKeys.catalog.availability('2026-11-06_2026-11-08_2_0_0', 'parkstay'),
  parkstayCheck: queryKeys.catalog.check('parkstay:20', STAY),
  racDetail: queryKeys.catalog.detail('rac:busselton'),
} as const;

function Listener() {
  useCredentialChangeUpdates();
  return null;
}

/** Which of the seeded answers are still in the cache. */
const cached = (queryClient: QueryClient) =>
  Object.fromEntries(
    Object.entries(KEYS).map(([name, key]) => [name, queryClient.getQueryData(key) !== undefined])
  );

describe('useCredentialChangeUpdates', () => {
  function setup() {
    const mock = createMockApi();
    const { queryClient } = renderWithProviders(<Listener />, { api: mock });
    for (const key of Object.values(KEYS)) queryClient.setQueryData(key, { seeded: true });
    return { mock, queryClient };
  }

  it("resets the provider's bulk counts and checks when its saved details change, and only those", () => {
    const { mock, queryClient } = setup();
    act(() => mock.emit('account:updated', RAC_SAVED));
    expect(cached(queryClient)).toEqual({
      racBulk: false,
      racCheck: false,
      parkstayBulk: true,
      parkstayCheck: true,
      racDetail: true,
    });
  });

  it('does it for a removal too, and nothing for a sign-in account', () => {
    const { mock, queryClient } = setup();
    act(() => mock.emit('account:updated', account({ status: 'signed-in' })));
    expect(Object.values(cached(queryClient)).every(Boolean)).toBe(true);
    act(() => mock.emit('account:updated', racAccount()));
    expect(cached(queryClient)).toMatchObject({ racBulk: false, racCheck: false });
  });

  it("tells a provider's availability queries from the rest", () => {
    expect(isAvailabilityOf({ queryKey: KEYS.racBulk }, 'rac')).toBe(true);
    expect(isAvailabilityOf({ queryKey: KEYS.racCheck }, 'rac')).toBe(true);
    expect(isAvailabilityOf({ queryKey: KEYS.parkstayCheck }, 'rac')).toBe(false);
    expect(isAvailabilityOf({ queryKey: KEYS.racDetail }, 'rac')).toBe(false);
    // "racx:1" is another provider's place
    expect(isAvailabilityOf({ queryKey: queryKeys.catalog.check('racx:1', STAY) }, 'rac')).toBe(
      false
    );
    expect(isAvailabilityOf({ queryKey: queryKeys.accounts.list() }, 'rac')).toBe(false);
  });
});
