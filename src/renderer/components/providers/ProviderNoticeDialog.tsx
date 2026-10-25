import { useCallback, useId, useState, type ReactNode } from 'react';
import { useAcceptNotice, useProviderNotice, type ProviderNoticeStatus } from '../../api/providers';
import type { ProviderManifest } from '../../../shared/types/provider.types';
import { Button, Checkbox, Dialog, Notice } from '../ui';

export interface ProviderNoticeDialogProps {
  /** A provider whose manifest has a `notice`. */
  manifest: ProviderManifest;
  /** After main stored the acceptance: the parent closes the dialog and carries on. */
  onAccepted(status: ProviderNoticeStatus): void;
  /** Not now, Escape, the scrim or the close button; never while the acceptance is sent. */
  onClose(): void;
}

/**
 * A provider's notice (§12.37), before WA Stay sends it anything: its title, its paragraphs
 * and points as plain text, a checkbox with its `confirmLabel`, and Continue, disabled until
 * it is ticked; Not now leaves everything as it was. Mount it to open it and unmount it to
 * close it. Continue stores the acceptance at the version shown; a refusal (the notice changed
 * meanwhile) shows main's words.
 */
export function ProviderNoticeDialog({ manifest, onAccepted, onClose }: ProviderNoticeDialogProps) {
  const notice = manifest.notice;
  const accept = useAcceptNotice();
  const hintId = useId();
  const [ticked, setTicked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = accept.isPending;

  if (!notice) return null;

  const onContinue = async () => {
    if (!ticked || pending) return;
    setError(null);
    try {
      onAccepted(await accept.mutateAsync({ providerId: manifest.id, version: notice.version }));
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : "Your answer couldn't be saved. Try again."
      );
    }
  };

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title={notice.title}
      closeOnEsc={!pending}
      closeOnOverlayClick={!pending}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Not now
          </Button>
          <Button
            onClick={() => void onContinue()}
            disabled={!ticked}
            loading={pending}
            aria-describedby={ticked ? undefined : hintId}
          >
            Continue
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm text-fg">
        {error && <Notice tone="danger">{error}</Notice>}
        {notice.body
          .split(/\n\s*\n/)
          .filter((paragraph) => paragraph.trim())
          .map((paragraph) => (
            <p key={paragraph}>{paragraph.trim()}</p>
          ))}
        {notice.points.length > 0 && (
          <ul className="flex list-disc flex-col gap-2 pl-5">
            {notice.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        )}
        <Checkbox
          label={notice.confirmLabel}
          checked={ticked}
          onChange={(event) => setTicked(event.target.checked)}
        />
        {!ticked && (
          <p id={hintId} className="text-fg-muted">
            Tick the box to continue.
          </p>
        )}
      </div>
    </Dialog>
  );
}

export interface NoticeGate {
  /** The provider has a notice the person has not accepted (or its status is still loading). */
  needed: boolean;
  /** Opens the notice; `then` runs once it is accepted. */
  ask(then?: () => void): void;
  /** The dialog while it is open, for the caller to render. */
  dialog: ReactNode;
}

/**
 * A provider's notice for one screen: whether it is needed before a check, a way to ask, and
 * the dialog to render. A provider without a notice never needs one and asks nothing.
 */
export function useNoticeGate(manifest: ProviderManifest | undefined): NoticeGate {
  const required = Boolean(manifest?.notice);
  const status = useProviderNotice(manifest?.id, required);
  const [asking, setAsking] = useState<{ then?: () => void } | null>(null);
  const ask = useCallback((then?: () => void) => setAsking({ then }), []);
  const dialog =
    asking && manifest?.notice ? (
      <ProviderNoticeDialog
        manifest={manifest}
        onAccepted={() => {
          setAsking(null);
          asking.then?.();
        }}
        onClose={() => setAsking(null)}
      />
    ) : null;
  return { needed: required && status.data?.accepted !== true, ask, dialog };
}

export default ProviderNoticeDialog;
