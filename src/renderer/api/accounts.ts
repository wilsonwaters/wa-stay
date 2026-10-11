import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ProviderAccount, ProviderId } from '../../shared/types/provider.types';
import { unwrap } from './client';
import { useApiEvent } from './events';
import { queryKeys } from './queryKeys';

/** One `account:updated` burst refreshes the accounts once, however many hooks listen. */
export const ACCOUNT_EVENT_COALESCE_MS = 50;
const pendingRefresh = new WeakMap<QueryClient, ReturnType<typeof setTimeout>>();

/**
 * Every list card asks for its provider's account, so `account:updated` reaches many hooks at
 * once: the first schedules one invalidation for the whole app (per query client), the rest
 * see it pending and do nothing.
 */
function useAccountUpdates(): void {
  const queryClient = useQueryClient();
  useApiEvent('account:updated', () => {
    if (pendingRefresh.has(queryClient)) return;
    pendingRefresh.set(
      queryClient,
      setTimeout(() => {
        pendingRefresh.delete(queryClient);
        void queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all });
      }, ACCOUNT_EVENT_COALESCE_MS)
    );
  });
}

function listAccounts(): Promise<ProviderAccount[]> {
  return unwrap((api) => api.accounts.list());
}

/** Puts an account main just returned into the stored list, so its row changes at once. */
function useStoreAccount() {
  const queryClient = useQueryClient();
  return (account: ProviderAccount) =>
    queryClient.setQueryData<ProviderAccount[]>(queryKeys.accounts.list(), (list) =>
      list?.map((stored) => (stored.providerId === account.providerId ? account : stored))
    );
}

/**
 * The person's account with a provider, as last recorded (`accounts.list()`: no request to the
 * provider), or `undefined` while loading or for a provider without sign-in. Refreshed on
 * `account:updated`.
 */
export function useAccountStatus(providerId: ProviderId | undefined) {
  useAccountUpdates();
  const select = useCallback(
    (accounts: ProviderAccount[]) => accounts.find((a) => a.providerId === providerId),
    [providerId]
  );
  return useQuery({
    queryKey: queryKeys.accounts.list(),
    queryFn: listAccounts,
    select,
    enabled: Boolean(providerId),
  });
}

/** Every provider account with sign-in, as last recorded; refreshed on `account:updated`. */
export function useAccounts() {
  useAccountUpdates();
  return useQuery({ queryKey: queryKeys.accounts.list(), queryFn: listAccounts });
}

/** Main reuses a definite answer for 60 s; asking more often only gets the same answer. */
const ACCOUNT_CHECK_STALE_MS = 60_000;

/**
 * Asks the provider once whether its session is still signed in (`accounts.status`, one
 * read-only request; main caches it for 60 s). Nothing polls: it runs when a view that shows
 * the status mounts. A changed answer arrives as `account:updated`, which reloads
 * `useAccounts`.
 */
export function useAccountCheck(providerId: ProviderId, { enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.accountChecks.check(providerId),
    queryFn: () => unwrap((api) => api.accounts.status(providerId)),
    staleTime: ACCOUNT_CHECK_STALE_MS,
    retry: false,
    enabled,
  });
}

/**
 * Opens the provider's sign-in window. Resolves with the account once sign-in is confirmed or
 * the window is closed (then the account is unchanged); rejects if the window can't open.
 */
export function useSignIn() {
  const queryClient = useQueryClient();
  const storeAccount = useStoreAccount();
  return useMutation({
    mutationFn: (providerId: ProviderId) => unwrap((api) => api.accounts.signIn(providerId)),
    onSuccess: storeAccount,
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
  });
}

/**
 * Signs out of a provider: its session on this computer is cleared. Rejects with
 * `ACCOUNT_BUSY` while a snipe or hold needs the session.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  const storeAccount = useStoreAccount();
  return useMutation({
    mutationFn: (providerId: ProviderId) => unwrap((api) => api.accounts.signOut(providerId)),
    onSuccess: storeAccount,
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
  });
}

/**
 * Loads a sign-in link the person pasted in the sign-in window. Main checks it is one of the
 * provider's sign-in links (`VALIDATION` otherwise); the outcome arrives as `account:updated`.
 */
export function useOpenSignInLink() {
  return useMutation({
    mutationFn: ({ providerId, url }: { providerId: ProviderId; url: string }) =>
      unwrap((api) => api.accounts.openSignInLink(providerId, url)),
  });
}
