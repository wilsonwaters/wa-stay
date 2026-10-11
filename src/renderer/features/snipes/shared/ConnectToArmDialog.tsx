import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { useAccountStatus } from '../../../api';
import { ConnectAccountPrompt } from '../../../components/accounts/ConnectAccountPrompt';
import { Button, Dialog } from '../../../components/ui';

export interface ConnectToArmDialogProps {
  manifest: ProviderManifest;
  snipeName: string;
  open: boolean;
  onClose: () => void;
  /** Arms the snipe, once the account is connected. */
  onArm: () => void;
}

/**
 * "Arm" on a snipe whose provider needs an account for holds, while signed out: the Connect
 * prompt in a dialog instead of arming (main would refuse, §12.32). Once connected, the snipe
 * can be armed from here; closing it leaves the snipe unarmed.
 */
export function ConnectToArmDialog({
  manifest,
  snipeName,
  open,
  onClose,
  onArm,
}: ConnectToArmDialogProps) {
  const account = useAccountStatus(manifest.id);
  const signedIn = account.data?.status === 'signed-in';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Connect ${manifest.shortName} to arm ${snipeName}`}
      description={`${manifest.shortName} holds sites only for people signed in to it.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {signedIn ? 'Not now' : 'Cancel'}
          </Button>
          {signedIn && (
            <Button variant="primary" onClick={onArm}>
              Arm now
            </Button>
          )}
        </>
      }
    >
      <ConnectAccountPrompt
        manifest={manifest}
        message={`Sign in on ${manifest.shortName}'s own page. WA Stay keeps the session for the hold and the payment.`}
      />
    </Dialog>
  );
}

export default ConnectToArmDialog;
