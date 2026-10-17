import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { CircleCheck, KeyRound, LogIn } from 'lucide-react';
import { useAccountCheck, useAccountStatus, useSignIn } from '../../api/accounts';
import type { ProviderAccount, ProviderManifest } from '../../../shared/types/provider.types';
import { ROUTES } from '../../app/routes';
import { Button, Notice, useAnnounce } from '../ui';
import { buttonClassName } from '../ui/Button';
import { cx } from '../ui/cx';
import { inSentence } from './credentialText';

export interface ConnectAccountPromptProps {
  manifest: ProviderManifest;
  /**
   * `any` (default): a blocking prompt for a provider that needs an account
   * (`required-for-holds`, `required`), and a gentle hint for one where it is `optional`.
   * `required`: only the blocking prompt (a list card stays quiet for optional accounts).
   */
  when?: 'any' | 'required';
  /**
   * What signing in is for. Defaults to a generic line for the provider's requirement. Not
   * used for a `credentials` account, which is added in Settings rather than signed in to.
   */
  message?: string;
  /** One line and a small button, for a card. */
  compact?: boolean;
  className?: string;
}

/** Said after the sign-in window closed without signing in (U2 spec). */
export const NOT_CONNECTED = 'Not connected. You can connect later in Settings → Accounts.';

const needsAccount = (manifest: ProviderManifest) =>
  manifest.capabilities.account === 'required' ||
  manifest.capabilities.account === 'required-for-holds';

/** What a `credentials` account's details are called in a sentence: "RAC member number". */
const detailsName = (account: ProviderAccount) => {
  const fields = account.fields ?? [];
  return fields.length === 1 ? inSentence(fields[0].label) : 'details';
};

/**
 * For a provider whose account is details saved in the app (`credentials`, such as an RAC
 * member number): there is no sign-in window (main answers `NOT_IMPLEMENTED`), so it points to
 * Settings → Accounts, where they are added. Blocking for a provider whose holds need them, a
 * soft line where they are optional; nothing once they are saved.
 */
function AddDetailsPrompt({
  manifest,
  account,
  required,
  compact,
  className,
}: {
  manifest: ProviderManifest;
  account: ProviderAccount;
  required: boolean;
  compact: boolean;
  className?: string;
}) {
  const name = detailsName(account);
  const to = ROUTES.settings('accounts', { provider: manifest.id });
  if (!required) {
    return (
      <p className={cx('text-sm text-fg-secondary', className)}>
        You can add your {name} in{' '}
        <Link to={to} className="font-semibold text-brand-strong underline">
          Settings → Accounts
        </Link>
        .
      </p>
    );
  }
  const text = `${manifest.shortName} needs your ${name} before it can hold anything for you.`;
  const add = (
    <Link to={to} className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
      <KeyRound size={16} aria-hidden="true" />
      Add {name}
    </Link>
  );
  if (!compact) {
    return (
      <Notice tone="warning" title={`Add your ${name}`} actions={add} className={className}>
        {text}
      </Notice>
    );
  }
  return (
    <div className={cx('flex flex-col gap-2 text-sm', className)}>
      <p className="font-semibold text-warning-fg">{text}</p>
      <div className="flex flex-wrap items-center gap-2">{add}</div>
    </div>
  );
}

/**
 * Asks the person to connect their account with a provider, on the provider's own sign-in page
 * in an app window (`accounts.signIn`). Blocking for a provider whose holds need an account, a
 * soft suggestion where it is optional (§12.32), and nothing once signed in or for a provider
 * without accounts. A status that failed to load or is unknown counts as signed out, with
 * Retry. When the window closes, focus comes back here and the outcome is announced. A
 * provider whose account is details saved in the app (`credentials`) gets a link to Settings →
 * Accounts instead (`AddDetailsPrompt`): it has no sign-in window.
 */
export function ConnectAccountPrompt({
  manifest,
  when = 'any',
  message,
  compact = false,
  className,
}: ConnectAccountPromptProps) {
  const account = useAccountStatus(manifest.id);
  const signIn = useSignIn();
  // Asks the provider again only on Retry (U4's check, which Settings → Accounts runs on view).
  const check = useAccountCheck(manifest.id, { enabled: false });
  const announce = useAnnounce();
  const buttonRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const [outcome, setOutcome] = useState<'connected' | 'not-connected'>();
  const { shortName } = manifest;
  const required = needsAccount(manifest);
  const signedIn = account.data?.status === 'signed-in';
  const uncertain = account.isError || account.data?.status === 'unknown';

  useEffect(() => {
    if (outcome === 'connected') doneRef.current?.focus();
    if (outcome === 'not-connected') buttonRef.current?.focus();
  }, [outcome]);

  if (manifest.capabilities.account === 'none' || (!required && when === 'required')) return null;
  // Not before the status is known, so a signed-in person never sees it flash.
  if (account.isPending) return null;
  if (account.data?.authKind === 'credentials') {
    if (signedIn) return null;
    return (
      <AddDetailsPrompt
        manifest={manifest}
        account={account.data}
        required={required}
        compact={compact}
        className={className}
      />
    );
  }
  if (signedIn) {
    if (outcome !== 'connected') return null;
    return (
      <p
        ref={doneRef}
        tabIndex={-1}
        className={cx('flex items-center gap-2 text-sm text-available-fg', className)}
      >
        <CircleCheck size={16} aria-hidden="true" />
        Connected to {shortName}.
      </p>
    );
  }

  const connect = () =>
    signIn.mutate(manifest.id, {
      onSuccess: (result) => {
        const ok = result.status === 'signed-in';
        setOutcome(ok ? 'connected' : 'not-connected');
        announce(ok ? `Connected to ${shortName}` : NOT_CONNECTED);
      },
      onError: (error) => {
        setOutcome('not-connected');
        announce(`${shortName} sign-in didn't work. ${error.message}`);
      },
    });

  // Ask the provider again, then reload the recorded account (a changed answer is stored there).
  const retry = () => void check.refetch().then(() => account.refetch());

  const text =
    message ??
    (required
      ? `${shortName} needs you signed in before it can hold anything for you.`
      : `Connect ${shortName} so checkout is quicker.`);
  const buttons = (
    <>
      <Button
        ref={buttonRef}
        variant="secondary"
        size="sm"
        leadingIcon={<LogIn size={16} />}
        onClick={connect}
        loading={signIn.isPending}
      >
        Connect {shortName}
      </Button>
      {uncertain && (
        <Button
          variant="ghost"
          size="sm"
          onClick={retry}
          loading={check.isFetching || account.isRefetching}
        >
          Retry
        </Button>
      )}
    </>
  );
  // Not a live region: the outcome is announced once, by the announcer.
  let after = null;
  if (signIn.isPending) after = <>Finish signing in in the {shortName} window.</>;
  else if (outcome === 'not-connected') {
    after = (
      <>
        Not connected. You can connect later in{' '}
        <Link
          to={ROUTES.settings('accounts', { provider: manifest.id })}
          className="font-semibold text-brand-strong underline"
        >
          Settings → Accounts
        </Link>
        .
      </>
    );
  } else if (uncertain) after = <>WA Stay couldn&apos;t tell whether you&apos;re signed in.</>;
  const afterLine = after && <p className="text-sm text-fg-secondary">{after}</p>;

  if (required && !compact) {
    return (
      <div className={cx('flex flex-col gap-2', className)}>
        <Notice tone="warning" title={`Connect ${shortName}`} actions={buttons}>
          {text}
        </Notice>
        {afterLine}
      </div>
    );
  }
  return (
    <div className={cx('flex flex-col gap-2 text-sm', className)}>
      <p className={required ? 'font-semibold text-warning-fg' : 'text-fg-secondary'}>{text}</p>
      <div className="flex flex-wrap items-center gap-2">{buttons}</div>
      {afterLine}
    </div>
  );
}

export default ConnectAccountPrompt;
