/**
 * What an account row says (Settings → Accounts): its status line, its action, and what the
 * account is needed for, from the provider's manifest (architecture-notes §12.32: signing in
 * is a soft suggestion for providers whose account is optional, never a blocker).
 */
import type { ProviderAccount, ProviderManifest } from '../../../../shared/types/provider.types';
import { formatDay } from '../format';

export type AccountAction = 'connect' | 'reconnect' | 'sign-out';

export interface AccountRowText {
  /** "Signed in as ann@example.com", "Signed out", "Not connected", "No account needed". */
  status: string;
  /** `signed-in` and `warning` take their state's colour and icon; `neutral` is muted. */
  tone: 'signed-in' | 'neutral' | 'warning';
  /** The row's one button, or none for a provider without accounts. */
  action: AccountAction | null;
  /** "ann@example.com · last signed in Fri 3 Oct 2026", when anything is known. */
  meta?: string;
}

export const ACTION_LABELS: Record<AccountAction, string> = {
  connect: 'Connect',
  reconnect: 'Reconnect',
  'sign-out': 'Sign out',
};

function requiresAccount(manifest: ProviderManifest): boolean {
  const { account } = manifest.capabilities;
  return account === 'required-for-holds' || account === 'required';
}

/**
 * The status line and action. Main records a sign-out and an expired session the same way
 * (`signed-out`, keeping the last sign-in), so a row that was signed in before reads "Signed
 * out" with "Reconnect", never a guess at why.
 */
export function accountRowText(
  manifest: ProviderManifest,
  account: ProviderAccount | undefined
): AccountRowText {
  if (manifest.capabilities.account === 'none') {
    return { status: 'No account needed', tone: 'neutral', action: null };
  }
  const lastSignedIn = account?.lastSignedInAt ? formatDay(account.lastSignedInAt) : '';
  const signedIn = account?.status === 'signed-in';
  const label = account?.displayName || account?.email;
  const meta =
    [signedIn ? '' : account?.email, lastSignedIn ? `last signed in ${lastSignedIn}` : '']
      .filter(Boolean)
      .join(' · ') || undefined;

  if (signedIn) {
    return {
      status: label ? `Signed in as ${label}` : 'Signed in',
      tone: 'signed-in',
      action: 'sign-out',
      meta,
    };
  }
  const tone = requiresAccount(manifest) ? 'warning' : 'neutral';
  if (lastSignedIn) return { status: 'Signed out', tone, action: 'reconnect', meta };
  return { status: 'Not connected', tone, action: 'connect', meta };
}

/**
 * "Needed for holds (Site Sniper and automatic holds)", naming only what the provider has:
 * Site Sniper with `snipes`, automatic holds with `holds` and `watches` (a watch places them).
 */
function neededForHolds({ holds, snipes, watches }: ProviderManifest['capabilities']): string {
  const sniper = snipes;
  const automatic = holds && watches;
  if (sniper && automatic) return 'Needed for holds (Site Sniper and automatic holds).';
  if (sniper) return 'Needed for holds (Site Sniper).';
  if (automatic) return 'Needed for automatic holds.';
  return 'Needed for holds.';
}

/**
 * What the account is needed for, from the manifest's capabilities, or null for a provider
 * without accounts (its status line already says "No account needed"). Signed in to an
 * optional account, the suggestion to connect becomes what being signed in gives. A release
 * is mentioned only for a provider with Site Sniper (`snipes`).
 */
export function accountPurpose(
  manifest: ProviderManifest,
  account?: Pick<ProviderAccount, 'status'>
): string | null {
  const { capabilities } = manifest;
  const { account: requirement, holds, snipes, bookingImport } = capabilities;
  const name = manifest.shortName;
  const signedIn = account?.status === 'signed-in';
  let purpose: string;
  switch (requirement) {
    case 'none':
      return null;
    case 'optional':
      if (!holds) purpose = 'Optional.';
      else if (signedIn) purpose = "Optional. Checkout is quicker while you're signed in.";
      else {
        const when = snipes ? ' before a release' : '';
        purpose = `Optional. Connect ${name}${when} so checkout is quicker. Holds work without it.`;
      }
      break;
    case 'required-for-holds':
      purpose = neededForHolds(capabilities);
      break;
    case 'required':
      purpose = `Needed for everything WA Stay does on ${name}.`;
      break;
  }
  return bookingImport ? `${purpose} Also used to import your bookings.` : purpose;
}

/** The warning under a row whose provider needs an account it doesn't have. */
export function missingAccountWarning(
  manifest: ProviderManifest,
  account: ProviderAccount | undefined
): string | null {
  if (!requiresAccount(manifest) || account?.status === 'signed-in') return null;
  return manifest.capabilities.account === 'required'
    ? `${manifest.shortName} can't be used until you connect.`
    : `${manifest.shortName} holds can't be placed until you connect.`;
}
