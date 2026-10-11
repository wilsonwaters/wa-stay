import { useState, type ReactNode } from 'react';
import { Send } from 'lucide-react';
import { useTestEmailNotifier } from '../../../../api';
import { Button } from '../../../../components/ui';
import { cx } from '../../../../components/ui/cx';
import { friendlySmtpError, SMTP_ERROR_DETAIL, type SmtpServer } from './smtpErrors';

export interface SendTestButtonProps {
  /** Unsaved changes: "Save and send test", which runs `save` first (false: not saved). */
  save?: () => Promise<boolean>;
  /** Where the test goes, for the success message. */
  recipient: string;
  /** The server the test connects to, for a failure in plain words. */
  server: SmtpServer;
  /** Buttons before this one, on the same row ("Edit settings"). */
  before?: ReactNode;
  disabled?: boolean;
}

type Result = { ok: boolean; message: string };

/**
 * Sends a test email with the saved settings. The result is read out from a polite live
 * region that is always rendered, so the change is announced. A failure says what went wrong
 * in plain words; the raw error stays in the logs.
 */
export function SendTestButton({ save, recipient, server, before, disabled }: SendTestButtonProps) {
  const test = useTestEmailNotifier();
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const failed = (raw: string | undefined): Result => ({
    ok: false,
    message: `${friendlySmtpError(raw, server)} ${SMTP_ERROR_DETAIL}`,
  });

  const run = async () => {
    setResult(null);
    if (save) {
      setSaving(true);
      const saved = await save().finally(() => setSaving(false));
      if (!saved) return;
    }
    try {
      const outcome = await test.mutateAsync();
      setResult(
        outcome.success
          ? { ok: true, message: `Test email sent to ${recipient}. Check your inbox.` }
          : failed(outcome.error || outcome.message)
      );
    } catch (error) {
      setResult(failed(error instanceof Error ? error.message : String(error)));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {before}
        <Button
          variant="secondary"
          leadingIcon={<Send size={16} aria-hidden="true" />}
          loading={saving || test.isPending}
          disabled={disabled}
          onClick={() => void run()}
        >
          {save ? 'Save and send test' : 'Send test email'}
        </Button>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={cx('text-sm', result?.ok === false ? 'text-danger' : 'text-fg-secondary')}
      >
        {result?.message}
      </p>
    </div>
  );
}

export default SendTestButton;
