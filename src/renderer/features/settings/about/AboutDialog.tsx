import { useRef, useState } from 'react';
import { APP_NAME } from '@shared/constants';
import { Logo } from '../../../components/brand/Logo';
import { Button, Dialog } from '../../../components/ui';
import { AboutPanel } from './AboutPanel';

export interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The B1 lockup, or the text wordmark if the artwork cannot be loaded (never a broken image).
 * Decorative either way: the dialog's title already says "About WA Stay".
 */
function BrandHeader() {
  const [failed, setFailed] = useState(false);
  return (
    <div className="mb-4 flex justify-center" aria-hidden="true">
      {failed ? (
        <p className="font-display text-display-sm font-medium text-fg">{APP_NAME}</p>
      ) : (
        <Logo variant="lockup" decorative className="h-10 w-auto" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

/**
 * "About WA Stay" from the account menu: a D2 Dialog (named by its title, focus trapped,
 * Escape closes it and focus returns to the menu button) around the About panel.
 */
export function AboutDialog({ open, onClose }: AboutDialogProps) {
  const doneRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`About ${APP_NAME}`}
      size="sm"
      initialFocusRef={doneRef}
      footer={
        <Button ref={doneRef} variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <BrandHeader />
      <AboutPanel />
    </Dialog>
  );
}

export default AboutDialog;
