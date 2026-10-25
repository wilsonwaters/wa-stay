import { useState } from 'react';
import { CircleCheck, CircleDashed } from 'lucide-react';
import { useProviderNotice, useWithdrawNotice, type ProviderManifest } from '../../../api';
import { ProviderNoticeDialog } from '../../../components/providers/ProviderNoticeDialog';
import { Button, ConfirmDialog, Notice, Skeleton, useAnnounce } from '../../../components/ui';
import { cx } from '../../../components/ui/cx';

export const NOTICE_TEXT = {
  heading: 'Notice',
  read: 'Read the notice',
  withdraw: 'Withdraw',
  loadFailed: "The notice couldn't be loaded",
} as const;

/** "18 Oct 2026", where the provider is. */
function acceptedOn(acceptedAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(new Date(acceptedAt));
}

/**
 * A provider's notice on its Settings → Accounts row (§12.37): accepted on a date, with
 * Withdraw (asked first, then WA Stay stops checking the provider at once), or not accepted,
 * with "Read the notice", which opens it to accept.
 */
export function NoticeSetting({ manifest }: { manifest: ProviderManifest }) {
  const status = useProviderNotice(manifest.id);
  const withdraw = useWithdrawNotice();
  const announce = useAnnounce();
  const [reading, setReading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const { shortName } = manifest;
  const statusId = `notice-${manifest.id}-status`;

  const confirmWithdraw = async () => {
    // A failure rejects: the dialog stays open and shows it
    await withdraw.mutateAsync(manifest.id);
    setWithdrawing(false);
    announce(`Withdrawn. WA Stay no longer checks ${shortName}.`);
  };

  let body;
  if (status.isPending) {
    body = <Skeleton className="h-5 w-48" />;
  } else if (status.isError) {
    body = (
      <Notice
        tone="danger"
        title={NOTICE_TEXT.loadFailed}
        actions={
          <Button variant="secondary" size="sm" onClick={() => void status.refetch()}>
            Try again
          </Button>
        }
      >
        {status.error.message}
      </Notice>
    );
  } else {
    const { accepted, acceptedAt } = status.data;
    const Icon = accepted ? CircleCheck : CircleDashed;
    body = (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <p
            id={statusId}
            className={cx(
              'flex items-center gap-1.5 text-sm font-medium',
              accepted ? 'text-available-fg' : 'text-fg-secondary'
            )}
          >
            <Icon size={16} aria-hidden="true" className="shrink-0" />
            {accepted && acceptedAt
              ? `Notice accepted on ${acceptedOn(acceptedAt, manifest.timezone)}`
              : 'Notice not accepted'}
          </p>
          <p className="text-sm text-fg-muted">
            {accepted
              ? `WA Stay checks ${shortName} for you. Withdraw to stop at once.`
              : `WA Stay checks nothing on ${shortName} until you've read and accepted it.`}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          aria-describedby={statusId}
          onClick={() => (accepted ? setWithdrawing(true) : setReading(true))}
        >
          {accepted ? NOTICE_TEXT.withdraw : NOTICE_TEXT.read}
        </Button>
      </div>
    );
  }

  return (
    <section
      aria-label={`${manifest.name} ${NOTICE_TEXT.heading.toLowerCase()}`}
      className="mt-4 flex max-w-prose flex-col gap-3"
    >
      <h4 className="text-sm font-semibold text-fg">{NOTICE_TEXT.heading}</h4>
      {body}
      {reading && (
        <ProviderNoticeDialog
          manifest={manifest}
          onAccepted={() => {
            setReading(false);
            announce(`Notice accepted. WA Stay can check ${shortName} now.`);
          }}
          onClose={() => setReading(false)}
        />
      )}
      <ConfirmDialog
        open={withdrawing}
        tone="danger"
        title={`Withdraw your acceptance of ${shortName}'s notice?`}
        message={`WA Stay stops checking ${shortName} at once. Its watches pause until you accept the notice again.`}
        confirmLabel={NOTICE_TEXT.withdraw}
        onConfirm={confirmWithdraw}
        onCancel={() => setWithdrawing(false)}
      />
    </section>
  );
}

export default NoticeSetting;
