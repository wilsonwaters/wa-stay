import { useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { NotifierStatus } from '../../../../../shared/types/notifier.types';
import {
  useEmailNotifier,
  useSetEmailNotifierEnabled,
  type EmailNotifierView,
} from '../../../../api';
import {
  Button,
  Card,
  Notice,
  Skeleton,
  Switch,
  useAnnounce,
  useToast,
} from '../../../../components/ui';
import { formatDay } from '../../format';
import { EmailNotifierForm } from './EmailNotifierForm';
import { SendTestButton } from './SendTestButton';
import { friendlySmtpError } from './smtpErrors';

function isSetUp(view: EmailNotifierView | null | undefined): view is EmailNotifierView {
  return Boolean(view) && view?.status !== NotifierStatus.NOT_CONFIGURED;
}

function statusText(view: EmailNotifierView | null | undefined): string {
  if (!isSetUp(view)) return 'Not set up';
  // In plain words; the raw error (nodemailer's code, the server's reply) is in the logs
  if (view.status === NotifierStatus.ERROR) return friendlySmtpError(view.lastError, view.config);
  return view.enabled ? 'On' : 'Off';
}

function summary(view: EmailNotifierView): string {
  const to = view.config.toEmail || view.config.auth.user;
  const tested = view.lastTestedAt ? ` · last tested ${formatDay(view.lastTestedAt)}` : '';
  return `Sends to ${to} through ${view.config.host}${tested}`;
}

/**
 * The email notifier (Settings → Notifications): its status, an on/off switch, a one-line
 * summary, and the settings form inline. Turning it on before it is set up opens the form
 * instead of switching it on.
 */
export function EmailNotifierCard() {
  const notifier = useEmailNotifier();
  const setEnabled = useSetEmailNotifierEnabled();
  const announce = useAnnounce();
  const toast = useToast();
  // How the form was opened: from the button it replaces, focus moves into it.
  const [editing, setEditing] = useState<false | 'button' | 'switch'>(false);
  const editButton = useRef<HTMLButtonElement>(null);

  if (notifier.isPending) {
    return (
      <div aria-busy="true">
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }
  if (notifier.isError) {
    return (
      <Notice
        tone="danger"
        title="Email settings couldn't be loaded"
        actions={
          <Button variant="secondary" size="sm" onClick={() => void notifier.refetch()}>
            Try again
          </Button>
        }
      >
        {notifier.error.message}
      </Notice>
    );
  }

  const view = notifier.data;
  const setUp = isSetUp(view);
  const failed = setUp && view.status === NotifierStatus.ERROR;

  const toggle = (on: boolean) => {
    if (!setUp) {
      // Nothing to switch on yet: the form comes first
      setEditing(on ? 'switch' : false);
      return;
    }
    setEnabled.mutate(on, {
      onSuccess: () => announce(`Email notifications ${on ? 'on' : 'off'}`),
      onError: () => toast.error("Couldn't save that setting. Try again."),
    });
  };

  const close = (saved: boolean) => {
    setEditing(false);
    if (saved) announce('Email settings saved');
    requestAnimationFrame(() => editButton.current?.focus());
  };

  // Edit and test sit on one row
  const editOrSetUp = (
    <Button ref={editButton} variant="secondary" onClick={() => setEditing('button')}>
      {setUp ? 'Edit settings' : 'Set up email'}
    </Button>
  );

  return (
    <Card padding="lg" className="flex flex-col gap-5">
      <Switch
        label="Email notifications"
        description="Alerts by email when a watch finds a site or a site is held."
        checked={setUp ? view.enabled : Boolean(editing)}
        disabled={setEnabled.isPending}
        onChange={(event) => toggle(event.target.checked)}
      />
      <div className="flex flex-col gap-1 text-sm">
        <p
          className={
            failed ? 'flex items-center gap-1.5 font-medium text-danger' : 'font-medium text-fg'
          }
        >
          {failed && <CircleAlert size={16} aria-hidden="true" />}
          {statusText(view)}
        </p>
        {setUp && <p className="text-fg-secondary">{summary(view)}</p>}
      </div>
      {editing ? (
        <EmailNotifierForm
          notifier={setUp ? view : null}
          onClose={close}
          focusOnOpen={editing === 'button'}
        />
      ) : !setUp ? (
        <div>{editOrSetUp}</div>
      ) : (
        <SendTestButton
          recipient={view.config.toEmail || view.config.auth.user}
          server={view.config}
          before={editOrSetUp}
        />
      )}
    </Card>
  );
}

export default EmailNotifierCard;
