import { useId, useReducer, type ReactNode } from 'react';
import { CircleAlert, Download, RotateCw, X, type LucideIcon } from 'lucide-react';
import { APP_NAME } from '@shared/constants';
import { useApiEvent, useDownloadUpdate, useInstallUpdate } from '../../api';
import { Button, Card, IconButton } from '../../components/ui';
import { cx } from '../../components/ui/cx';
import {
  INITIAL_UPDATE_STATE,
  isUpdateCardShown,
  updateReducer,
  type UpdateView,
} from './updateState';

interface CardCopy {
  icon: LucideIcon;
  tone: string;
  title: string;
  body?: string;
}

function copyFor(view: Exclude<UpdateView, { state: 'idle' }>): CardCopy {
  const named = (version?: string) => (version ? `${APP_NAME} ${version}` : APP_NAME);
  switch (view.state) {
    case 'available':
      return {
        icon: Download,
        tone: 'text-brand',
        title: 'Update available',
        body: `${named(view.version)} is ready to download.`,
      };
    case 'downloading':
      return { icon: Download, tone: 'text-brand', title: `Downloading ${named(view.version)}` };
    case 'downloaded':
      return {
        icon: RotateCw,
        tone: 'text-brand',
        title: 'Update ready',
        body: `${named(view.version)} has downloaded. Restart ${APP_NAME} to finish updating.`,
      };
    case 'error':
      return {
        icon: CircleAlert,
        tone: 'text-danger',
        title: `${APP_NAME} couldn't update`,
        body: view.message,
      };
  }
}

/**
 * The update card in the tray, driven by `updater:*` events (each through `events.on` and its
 * own unsubscribe). Available: Download or Later. Downloading: a progress bar. Downloaded:
 * Restart now or Later. Error: the message and Dismiss. "Later" sets the card aside until
 * something new arrives. The updater's own behaviour is main's.
 */
export function UpdateCard() {
  const [state, dispatch] = useReducer(updateReducer, INITIAL_UPDATE_STATE);
  const download = useDownloadUpdate();
  const install = useInstallUpdate();
  const titleId = useId();

  useApiEvent('updater:available', ({ version }) => dispatch({ type: 'available', version }));
  useApiEvent('updater:not-available', () => dispatch({ type: 'not-available' }));
  useApiEvent('updater:progress', ({ percent }) => dispatch({ type: 'progress', percent }));
  useApiEvent('updater:downloaded', ({ version }) => dispatch({ type: 'downloaded', version }));
  useApiEvent('updater:error', ({ error }) => dispatch({ type: 'error', message: error }));

  if (!isUpdateCardShown(state) || state.view.state === 'idle') return null;
  const { view } = state;
  const { icon: Icon, tone, title, body } = copyFor(view);
  const failed = (error: Error) => dispatch({ type: 'error', message: error.message });
  const later = () => dispatch({ type: 'dismiss' });

  let actions: ReactNode = null;
  if (view.state === 'available') {
    actions = (
      <>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            dispatch({ type: 'download' });
            download.mutate(undefined, { onError: failed });
          }}
        >
          Download
        </Button>
        <Button variant="ghost" size="sm" onClick={later}>
          Later
        </Button>
      </>
    );
  } else if (view.state === 'downloaded') {
    actions = (
      <>
        <Button
          variant="secondary"
          size="sm"
          loading={install.isPending}
          onClick={() => install.mutate(undefined, { onError: failed })}
        >
          Restart now
        </Button>
        <Button variant="ghost" size="sm" onClick={later}>
          Later
        </Button>
      </>
    );
  } else if (view.state === 'error') {
    actions = (
      <Button variant="secondary" size="sm" onClick={later}>
        Dismiss
      </Button>
    );
  }

  return (
    <Card
      as="section"
      aria-labelledby={titleId}
      padding="sm"
      elevation="floating"
      className="pointer-events-auto"
    >
      <div className="flex items-start gap-3">
        <Icon size={20} aria-hidden="true" className={cx('mt-0.5 shrink-0', tone)} />
        <div className="min-w-0 flex-1">
          <p id={titleId} className="text-sm font-semibold text-fg">
            {title}
          </p>
          {body && <p className="mt-0.5 wrap-break-word text-sm text-fg-secondary">{body}</p>}
          {view.state === 'downloading' && (
            <>
              <div
                role="progressbar"
                aria-label="Update download"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={view.percent}
                className="mt-3 h-2 overflow-hidden rounded-full bg-surface-subtle"
              >
                <div
                  className="h-full w-full origin-left rounded-full bg-brand transition-transform duration-slow ease-standard"
                  style={{ transform: `scaleX(${view.percent / 100})` }}
                />
              </div>
              <p className="mt-1 text-xs tabular-nums text-fg-muted">{view.percent}%</p>
            </>
          )}
          {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
        </div>
        {view.state !== 'downloading' && (
          <IconButton
            size="sm"
            label="Dismiss update"
            icon={<X size={16} />}
            onClick={later}
            className="-m-1"
          />
        )}
      </div>
    </Card>
  );
}

export default UpdateCard;
