/**
 * Settings → Accounts set up for tests (U4): ParkStay, FakeStay (needs an account for holds)
 * and OpenStay (no accounts), with stored accounts that follow sign-in, sign-out and a
 * credentials save as main's do.
 */
import { screen, within } from '@testing-library/react';
import type { ProviderAccount, ProviderManifest } from '../../../src/shared/types/provider.types';
import { createMockApi, fail, ok } from '../../utils/renderer/createMockApi';
import { renderWithApp } from '../../utils/renderer/renderWithApp';
import { FAKESTAY, KEYSTAY, OPENSTAY, PARKSTAY, account, keyAccount } from './settings';

export const NOT_CONNECTED = account();
export const FAKE_NOT_CONNECTED = account({
  providerId: 'fakestay',
  requirement: 'required-for-holds',
});

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type AccountCall = (providerId: string) => Promise<unknown>;

/**
 * Settings → Accounts with ParkStay, FakeStay (needs an account for holds) and OpenStay (no
 * accounts), or the `providers` given. The stored accounts follow sign-in and sign-out, as main's do; `signIn` and
 * `signOut` give what main answers.
 */
export function setupAccounts({
  providers = [PARKSTAY, FAKESTAY, OPENSTAY],
  accounts = [NOT_CONNECTED, FAKE_NOT_CONNECTED],
  route = '/settings/accounts',
  signIn = () => Promise.resolve(fail('not stubbed')),
  signOut = () => Promise.resolve(fail('not stubbed')),
  openSignInLink = jest.fn().mockResolvedValue(ok(undefined)),
  saveCredentials = () => Promise.resolve(fail('not stubbed')),
  copyCredential = jest.fn().mockResolvedValue(ok(undefined)),
  experiments,
  setExperiment,
  notice,
  acceptNotice,
  withdrawNotice,
}: {
  /** The registered providers, in order. Default: ParkStay, FakeStay and OpenStay. */
  providers?: ProviderManifest[];
  accounts?: ProviderAccount[];
  route?: string;
  signIn?: AccountCall;
  signOut?: AccountCall;
  openSignInLink?: jest.Mock;
  /** What main answers to `accounts.saveCredentials`; the stored accounts follow a success. */
  saveCredentials?: (
    providerId: string,
    values: Record<string, string>,
    confirmed: string[]
  ) => Promise<unknown>;
  copyCredential?: jest.Mock;
  /** `providers.experiments` (R17); un-stubbed it rejects, as any call the test did not expect. */
  experiments?: jest.Mock;
  /** `providers.setExperiment` (R17). */
  setExperiment?: jest.Mock;
  /** `providers.notice`, `acceptNotice` and `withdrawNotice` (§12.36). */
  notice?: jest.Mock;
  acceptNotice?: jest.Mock;
  withdrawNotice?: jest.Mock;
} = {}) {
  let stored = accounts;
  const remember = async (answer: Promise<unknown>) => {
    const response = (await answer) as { success: boolean; data?: ProviderAccount };
    const changed = response.data;
    if (response.success && changed) {
      stored = stored.map((a) => (a.providerId === changed.providerId ? changed : a));
    }
    return response;
  };
  const mock = createMockApi({
    providers: {
      list: jest.fn().mockResolvedValue(ok(providers)),
      ...(experiments ? { experiments } : {}),
      ...(setExperiment ? { setExperiment } : {}),
      ...(notice ? { notice } : {}),
      ...(acceptNotice ? { acceptNotice } : {}),
      ...(withdrawNotice ? { withdrawNotice } : {}),
    },
    accounts: {
      list: jest.fn(() => Promise.resolve(ok(stored))),
      status: jest.fn((id: string) =>
        Promise.resolve(ok(stored.find((a) => a.providerId === id) ?? account()))
      ),
      signIn: jest.fn((id: string) => remember(signIn(id))),
      signOut: jest.fn((id: string) => remember(signOut(id))),
      openSignInLink,
      saveCredentials: jest.fn((id: string, values: Record<string, string>, confirmed: string[]) =>
        remember(saveCredentials(id, values, confirmed))
      ),
      copyCredential,
    },
  });
  return { ...renderWithApp({ route, api: mock }), mock };
}

export const row = (name: string) => {
  const heading = screen.getByRole('heading', { level: 3, name });
  return heading.closest('li') as HTMLElement;
};
export const rows = async () => {
  const list = await screen.findByRole('list', { name: 'Provider accounts' });
  return within(list).getAllByRole('listitem');
};

/** A made-up member number (never a real one), and KeyStay's two statements. */
export const MADE_UP_NUMBER = '1234567890123';
export const OWN_STATEMENT = 'This is my own member number.';
export const STAY_STATEMENT = "I'll be staying, in the name on the card.";

/** Settings → Accounts with ParkStay and KeyStay (a `credentials` account, nothing saved). */
export function setupCredentials(options: Parameters<typeof setupAccounts>[0] = {}) {
  return setupAccounts({
    providers: [PARKSTAY, KEYSTAY],
    accounts: [NOT_CONNECTED, keyAccount()],
    ...options,
  });
}

export const credentialsDialog = () => screen.getByRole('dialog', { name: 'KeyStay account' });

/** Ticks both of KeyStay's statements in the open form. */
export async function tickStatements(user: ReturnType<typeof setupAccounts>['user']) {
  await user.click(within(credentialsDialog()).getByRole('checkbox', { name: OWN_STATEMENT }));
  await user.click(within(credentialsDialog()).getByRole('checkbox', { name: STAY_STATEMENT }));
}
