import { useCallback, useRef, useState } from 'react';
import {
  useAccounts,
  useProviders,
  useSignIn,
  useSignOut,
  type ProviderManifest,
} from '../../../api';
import type { ProviderAccount } from '../../../../shared/types/provider.types';
import {
  Button,
  ConfirmDialog,
  Notice,
  Skeleton,
  VisuallyHidden,
  useAnnounce,
} from '../../../components/ui';
import { AccountRow, type SignInOutcome } from './AccountRow';
import type { AccountAction } from './accountText';
import { scrollRowIntoView, useProviderDeepLink } from './useProviderDeepLink';

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The sign-in window couldn't open. Try again.";
}

/**
 * Settings → Accounts: one row per registered provider (`providers.list()`), joined with the
 * stored accounts (`accounts.list()`, which lists only providers with sign-in). Connect opens
 * the provider's own sign-in window; one sign-in at a time. Sign out asks first.
 */
export function AccountsSection() {
  const providers = useProviders();
  const accounts = useAccounts();
  const signIn = useSignIn();
  const signOut = useSignOut();
  const announce = useAnnounce();
  const [outcomes, setOutcomes] = useState<Record<string, SignInOutcome | undefined>>({});
  const [signingOut, setSigningOut] = useState<ProviderManifest | null>(null);
  // The last provider asked about, so the dialog keeps its words while it closes
  const lastSigningOut = useRef<ProviderManifest | null>(null);
  if (signingOut) lastSigningOut.current = signingOut;
  const focusTargets = useRef(new Map<string, HTMLElement>());

  const pendingId = signIn.isPending ? signIn.variables : undefined;
  const ready = providers.isSuccess && accounts.isSuccess;

  const focusRow = useCallback((providerId: string) => {
    const target = focusTargets.current.get(providerId);
    if (!target) return false;
    scrollRowIntoView(document.getElementById(`account-${providerId}`));
    target.focus();
    return true;
  }, []);
  useProviderDeepLink(ready, focusRow);

  const connect = async (manifest: ProviderManifest) => {
    const id = manifest.id;
    setOutcomes((current) => ({ ...current, [id]: undefined }));
    try {
      const account = await signIn.mutateAsync(id);
      if (account.status === 'signed-in') {
        const label = account.displayName || account.email;
        announce(`Signed in to ${manifest.shortName}${label ? ` as ${label}` : ''}`);
      } else {
        setOutcomes((current) => ({ ...current, [id]: { kind: 'incomplete' } }));
        announce(`Sign-in to ${manifest.shortName} wasn't completed`);
      }
    } catch (error) {
      const message = errorMessage(error);
      setOutcomes((current) => ({ ...current, [id]: { kind: 'error', message } }));
      announce(message);
    } finally {
      // The button may now read "Sign out": focus goes back to it once it has re-rendered
      requestAnimationFrame(() => focusTargets.current.get(id)?.focus());
    }
  };

  const onAction = (manifest: ProviderManifest, action: AccountAction) => {
    if (action === 'sign-out') setSigningOut(manifest);
    else void connect(manifest);
  };

  const confirmSignOut = async () => {
    const manifest = signingOut;
    if (!manifest) return;
    // A refusal (ACCOUNT_BUSY) rejects: the dialog stays open and shows main's reason
    await signOut.mutateAsync(manifest.id);
    setSigningOut(null);
    announce(`Signed out of ${manifest.shortName}`);
  };

  if (providers.isPending || accounts.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <p role="status">
          <VisuallyHidden>Loading accounts</VisuallyHidden>
        </p>
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
    );
  }

  if (providers.isError || accounts.isError) {
    const failed = providers.isError ? providers : accounts;
    return (
      <Notice
        tone="danger"
        title="Accounts couldn't be loaded"
        actions={
          <Button variant="secondary" size="sm" onClick={() => void failed.refetch()}>
            Try again
          </Button>
        }
      >
        {failed.error?.message}
      </Notice>
    );
  }

  const accountOf = (id: string): ProviderAccount | undefined =>
    accounts.data.find((account) => account.providerId === id);
  const closing = signingOut ?? lastSigningOut.current;

  return (
    <>
      <ul aria-label="Provider accounts" className="divide-y divide-border">
        {providers.data.map((manifest) => (
          <AccountRow
            key={manifest.id}
            manifest={manifest}
            account={accountOf(manifest.id)}
            pending={pendingId === manifest.id}
            blocked={pendingId !== undefined && pendingId !== manifest.id}
            outcome={outcomes[manifest.id]}
            onAction={(action) => onAction(manifest, action)}
            focusRef={(element: HTMLElement | null) => {
              if (element) focusTargets.current.set(manifest.id, element);
              else focusTargets.current.delete(manifest.id);
            }}
          />
        ))}
      </ul>
      <ConfirmDialog
        open={signingOut !== null}
        title={`Sign out of ${closing?.shortName ?? ''}?`}
        message={`WA Stay forgets your ${closing?.shortName ?? ''} session on this computer. Watches and snipes keep running, and you can sign in again at any time.`}
        confirmLabel="Sign out"
        onConfirm={confirmSignOut}
        onCancel={() => setSigningOut(null)}
      />
    </>
  );
}

export default AccountsSection;
