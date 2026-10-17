/**
 * Settings → Accounts with an Experimental switch (R17): ParkStay, and CartStay, whose holds sit
 * behind `autoCart` (`providers.experiments` answers `state`).
 */
import { within } from '@testing-library/react';
import type { ProviderExperimentState } from '../../../src/shared/contracts';
import { ok } from '../../utils/renderer/createMockApi';
import { NOT_CONNECTED, row, setupAccounts } from './settings-accounts';
import { CARTSTAY, PARKSTAY } from './settings';

export const OFF: ProviderExperimentState = { id: 'autoCart', enabled: false, active: false };
export const ON: ProviderExperimentState = { id: 'autoCart', enabled: true, active: true };
export const BUSY = 'A stay is held on CartStay. Pay for it or let it go first.';
export const DIALOG = 'Turn on Hold a stay in the cart?';

/** Settings → Accounts with ParkStay and CartStay; `setExperiment` answers `state` changed. */
export function setupExperiments(
  state: ProviderExperimentState,
  setExperiment: jest.Mock = jest.fn((_id: string, _experiment: string, enabled: boolean) =>
    Promise.resolve(ok([{ ...state, enabled }]))
  )
) {
  const experiments = jest.fn().mockResolvedValue(ok([state]));
  const rendered = setupAccounts({
    providers: [PARKSTAY, CARTSTAY],
    accounts: [NOT_CONNECTED],
    experiments,
    setExperiment,
  });
  return { ...rendered, experiments, setExperiment };
}

/** CartStay's switch, once its row is in. */
export const cartSwitch = () =>
  within(row('Cart Stay')).findByRole('switch', { name: 'Hold a stay in the cart' });

/** The polite live region as it is: one announcement has no trailing no-break space. */
export const rawAnnouncement = () =>
  document.querySelector('[aria-live="polite"][aria-atomic="true"]')?.textContent ?? '';
