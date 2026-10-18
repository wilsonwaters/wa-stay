import { Copy } from 'lucide-react';
import { useAccountStatus, useCopyCredential } from '../../api/accounts';
import type {
  AccountFieldDescriptor,
  ProviderAccount,
  ProviderId,
} from '../../../shared/types/provider.types';
import { Button, useAnnounce, useToast, type ButtonSize, type ButtonVariant } from '../ui';
import { COPY_FAILED, copyCredentialLabel, credentialCopiedAnnouncement } from './credentialText';

/** The saved details of a `credentials` account that can be copied (`copyable`, in `savedFields`). */
export function copyableSavedFields(
  account: Pick<ProviderAccount, 'fields' | 'savedFields'> | undefined
): AccountFieldDescriptor[] {
  return (account?.fields ?? []).filter(
    (field) => field.copyable && account?.savedFields?.includes(field.key)
  );
}

export interface CopyCredentialButtonProps {
  /** The provider whose saved details may be copied; nothing shows without one. */
  providerId: ProviderId | undefined;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** What describes the button (Settings → Accounts: the row's status line). */
  'aria-describedby'?: string;
  className?: string;
}

/**
 * "Copy {label}" ("Copy RAC member number"), one for each detail the person saved for the
 * provider that can be copied (R15's `copyable` and `savedFields`), beside the provider's
 * booking or payment link so it is at hand at the provider's checkout. Main writes the value
 * to the clipboard (`accounts.copyCredential`, sent the provider and the field's key only): it
 * never reaches the window, and no name, title or tooltip shows it. Nothing shows while the
 * account loads, for a provider without accounts, or when nothing copyable is saved (so it goes
 * once the detail is removed). A copy is announced ("RAC member number copied") with focus
 * left on the button; a failure shows main's reason as an error toast.
 */
export function CopyCredentialButton({
  providerId,
  variant = 'secondary',
  size,
  fullWidth,
  className,
  'aria-describedby': describedBy,
}: CopyCredentialButtonProps) {
  const account = useAccountStatus(providerId);
  const copy = useCopyCredential();
  const announce = useAnnounce();
  const toast = useToast();
  const fields = copyableSavedFields(account.data);
  if (!providerId || fields.length === 0) return null;

  const copyField = async (field: AccountFieldDescriptor) => {
    try {
      await copy.mutateAsync({ providerId, key: field.key });
      announce(credentialCopiedAnnouncement(field));
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : COPY_FAILED);
    }
  };

  return (
    <>
      {fields.map((field) => (
        <Button
          key={field.key}
          variant={variant}
          size={size}
          fullWidth={fullWidth}
          className={className}
          aria-describedby={describedBy}
          loading={copy.isPending && copy.variables?.key === field.key}
          leadingIcon={<Copy size={size === 'sm' ? 16 : 18} aria-hidden="true" />}
          onClick={() => void copyField(field)}
        >
          {copyCredentialLabel(field)}
        </Button>
      ))}
    </>
  );
}

export default CopyCredentialButton;
