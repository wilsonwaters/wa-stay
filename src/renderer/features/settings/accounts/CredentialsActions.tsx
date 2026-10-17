import { useRef, useState } from 'react';
import { Copy, KeyRound, Trash2 } from 'lucide-react';
import { useCopyCredential, useSaveCredentials, useSignOut } from '../../../api';
import type {
  AccountFieldDescriptor,
  ProviderAccount,
  ProviderManifest,
} from '../../../../shared/types/provider.types';
import { Button, ConfirmDialog, useAnnounce, useToast } from '../../../components/ui';
import { mergeRefs } from '../../../components/ui/refs';
import {
  CREDENTIALS_TEXT,
  addCredentialsLabel,
  copyCredentialLabel,
  credentialsRemovedAnnouncement,
  credentialsSaved,
  credentialsSavedAnnouncement,
  removeCredentialsTitle,
} from './accountText';
import { CredentialsDialog } from './CredentialsDialog';

export interface CredentialsActionsProps {
  manifest: ProviderManifest;
  /** A `credentials` account: fields, confirmations and `savedFields` (key names only). */
  account: ProviderAccount;
  /** The row's first button (deep links focus it). */
  focusRef: (element: HTMLElement | null) => void;
  /** The row's status line, which describes each button. */
  statusId: string;
}

/**
 * A `credentials` row's buttons (Settings → Accounts): "Add {label}" while nothing is saved;
 * then "Replace", "Remove" and "Copy {label}" for each copyable saved field. Add and Replace
 * open the details form; Remove asks first, then calls `accounts.signOut`; Copy asks main to
 * put the value on the clipboard (the renderer never has it). Each outcome is announced
 * politely, and focus comes back to the row's first button.
 */
export function CredentialsActions({
  manifest,
  account,
  focusRef,
  statusId,
}: CredentialsActionsProps) {
  const saveCredentials = useSaveCredentials();
  const signOut = useSignOut();
  const copy = useCopyCredential();
  const announce = useAnnounce();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const firstButton = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const saved = credentialsSaved(account);
  const copyable = (account.fields ?? []).filter(
    (field) => field.copyable && account.savedFields?.includes(field.key)
  );

  // Once the row shows its new buttons (Add becomes Replace, and back)
  const focusFirstButton = () => requestAnimationFrame(() => firstButton.current?.focus());

  const onSaved = (result: ProviderAccount) => {
    setEditing(false);
    announce(credentialsSavedAnnouncement(result));
    focusFirstButton();
  };

  const confirmRemove = async () => {
    // A failure rejects: the dialog stays open and shows main's reason
    const result = await signOut.mutateAsync(manifest.id);
    setRemoving(false);
    announce(credentialsRemovedAnnouncement(result));
    focusFirstButton();
  };

  const copyField = async (field: AccountFieldDescriptor) => {
    try {
      await copy.mutateAsync({ providerId: manifest.id, key: field.key });
      announce(CREDENTIALS_TEXT.copied);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message ? error.message : CREDENTIALS_TEXT.copyFailed
      );
    }
  };

  const firstRef = mergeRefs(focusRef, firstButton);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {saved ? (
          <>
            <Button
              ref={firstRef}
              variant="secondary"
              aria-describedby={statusId}
              leadingIcon={<KeyRound size={18} aria-hidden="true" />}
              onClick={() => setEditing(true)}
            >
              {CREDENTIALS_TEXT.replace}
            </Button>
            <Button
              variant="secondary"
              aria-describedby={statusId}
              leadingIcon={<Trash2 size={18} aria-hidden="true" />}
              onClick={() => setRemoving(true)}
            >
              {CREDENTIALS_TEXT.remove}
            </Button>
            {copyable.map((field) => (
              <Button
                key={field.key}
                variant="secondary"
                loading={copy.isPending && copy.variables?.key === field.key}
                leadingIcon={<Copy size={18} aria-hidden="true" />}
                onClick={() => void copyField(field)}
              >
                {copyCredentialLabel(field)}
              </Button>
            ))}
          </>
        ) : (
          <Button
            ref={firstRef}
            variant="secondary"
            aria-describedby={statusId}
            leadingIcon={<KeyRound size={18} aria-hidden="true" />}
            onClick={() => setEditing(true)}
          >
            {addCredentialsLabel(account)}
          </Button>
        )}
      </div>
      {editing && (
        <CredentialsDialog
          manifest={manifest}
          account={account}
          pending={saveCredentials.isPending}
          onSave={(values, confirmed) => saveCredentials.save(manifest.id, values, confirmed)}
          onSaved={onSaved}
          onClose={() => setEditing(false)}
        />
      )}
      <ConfirmDialog
        open={removing}
        title={removeCredentialsTitle(account)}
        message={CREDENTIALS_TEXT.removeMessage}
        confirmLabel={CREDENTIALS_TEXT.remove}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(false)}
      />
    </>
  );
}

export default CredentialsActions;
