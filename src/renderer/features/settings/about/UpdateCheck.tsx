import { RefreshCw } from 'lucide-react';
import type { UseMutationResult } from '@tanstack/react-query';
import type { UpdateCheckOutcome } from '../../../api';
import { Button } from '../../../components/ui';
import { cx } from '../../../components/ui/cx';
import { updateCheckMessage } from './updateCheckMessage';

/** `useCheckForUpdates()`, shared by the button and the result. */
export type UpdateCheckState = UseMutationResult<UpdateCheckOutcome, Error, void>;

function failed(check: UpdateCheckState): boolean {
  return check.isError || check.data?.status.state === 'error';
}

/** "Check for updates", or "Retry" after a check that could not run. */
export function UpdateCheckButton({ check }: { check: UpdateCheckState }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      leadingIcon={<RefreshCw size={16} aria-hidden="true" />}
      loading={check.isPending}
      onClick={() => check.mutate()}
    >
      {failed(check) ? 'Retry' : 'Check for updates'}
    </Button>
  );
}

/**
 * What the check found, in words, in a polite live region that is always rendered (so the
 * change is read out). Downloading and installing stay with the update card.
 */
export function UpdateCheckResult({
  check,
  current,
}: {
  check: UpdateCheckState;
  current?: string;
}) {
  const message = check.isError
    ? "Couldn't check for updates"
    : check.data
      ? updateCheckMessage(check.data, current)
      : '';
  return (
    <p
      role="status"
      aria-live="polite"
      className={cx('text-sm', failed(check) ? 'text-danger' : 'text-fg-secondary')}
    >
      {message}
    </p>
  );
}
