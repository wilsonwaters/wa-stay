/**
 * Settings → Accounts set up for tests (U4): ParkStay, FakeStay (needs an account for holds)
 * and OpenStay (no accounts), with stored accounts that follow sign-in and sign-out as main's do.
 */
import { screen, within } from '@testing-library/react';
import type { ProviderAccount, ProviderManifest } from '../../../src/shared/types/provider.types';
import { createMockApi, fail, ok } from '../../utils/renderer/createMockApi';
import { renderWithApp } from '../../utils/renderer/renderWithApp';
import { FAKESTAY, OPENSTAY, PARKSTAY, account } from './settings';

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
}: {
  /** The registered providers, in order. Default: ParkStay, FakeStay and OpenStay. */
  providers?: ProviderManifest[];
  accounts?: ProviderAccount[];
  route?: string;
  signIn?: AccountCall;
  signOut?: AccountCall;
  openSignInLink?: jest.Mock;
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
    providers: { list: jest.fn().mockResolvedValue(ok(providers)) },
    accounts: {
      list: jest.fn(() => Promise.resolve(ok(stored))),
      status: jest.fn((id: string) =>
        Promise.resolve(ok(stored.find((a) => a.providerId === id) ?? account()))
      ),
      signIn: jest.fn((id: string) => remember(signIn(id))),
      signOut: jest.fn((id: string) => remember(signOut(id))),
      openSignInLink,
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
