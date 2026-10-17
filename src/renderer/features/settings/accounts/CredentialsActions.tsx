import { useRef, useState } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import { useSaveCredentials, useSignOut } from '../../../api';
import type { ProviderAccount, ProviderManifest } from '../../../../shared/types/provider.types';
import { CopyCredentialButton } from '../../../components/accounts/CopyCredentialButton';
import { Button, ConfirmDialog, useAnnounce } from '../../../components/ui';
import { mergeRefs } from '../../../components/ui/refs';
import {
  CREDENTIALS_TEXT,
  addCredentialsLabel,
  credentialsRemovedAnnouncement,
  credentialsSaved,
  credentialsSavedAnnouncement,
  removeCredentialsMessage,
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
 * then "Replace", "Remove" and "Copy {label}" for each copyable saved field
 * (`CopyCredentialButton`, the same button as beside a booking link). Add and Replace open the
 * details form; Remove asks first, then calls `accounts.signOut`; Copy asks main to put the
 * value on the clipboard (the renderer never has it). Each outcome is announced politely;
 * after a save or a removal, focus comes back to the row's first button.
 */
export function CredentialsActions({
  manifest,
  account,
  focusRef,
  statusId,
}: CredentialsActionsProps) {
  const saveCredentials = useSaveCredentials();
  const signOut = useSignOut();
  const announce = useAnnounce();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const firstButton = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const saved = credentialsSaved(account);

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
            <CopyCredentialButton providerId={manifest.id} aria-describedby={statusId} />
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
        message={removeCredentialsMessage(account)}
        confirmLabel={CREDENTIALS_TEXT.remove}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(false)}
      />
    </>
  );
}

export default CredentialsActions;
