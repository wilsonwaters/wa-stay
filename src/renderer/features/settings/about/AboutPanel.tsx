import type { ReactNode } from 'react';
import { FolderOpen } from 'lucide-react';
import { APP_DESCRIPTION, APP_ISSUES_URL, APP_REPO_URL } from '@shared/constants';
import { useAppInfo, useOpenLogsFolder } from '../../../api';
import { ExternalLink } from '../../../components/ExternalLink';
import { Button, Disclosure, Notice, Spinner } from '../../../components/ui';
import { cx } from '../../../components/ui/cx';

export interface AboutPanelProps {
  /**
   * More actions, after GitHub, Report an issue and Open logs folder in the same row: Settings
   * → About adds its update check here.
   */
  actions?: ReactNode;
  /** More content under the actions, above the licence line (a result message, a Notice). */
  children?: ReactNode;
  /**
   * `center` (default) under the dialog's centred logo; `start` for a page section, such as
   * Settings → About, where everything lines up with the section heading.
   */
  align?: 'center' | 'start';
}

/**
 * About WA Stay: the version, what the app is, the runtime details (in a "Technical details"
 * disclosure, closed at first), where to get help and the logs folder. The single source for About content (master plan, shared building blocks): the
 * account menu's About dialog wraps it, and Settings → About renders it with its own `actions`
 * and `children`. It has no heading of its own, so it fits under either one.
 */
export function AboutPanel({ actions, children, align = 'center' }: AboutPanelProps) {
  const info = useAppInfo();
  const openLogs = useOpenLogsFolder();
  const centred = align === 'center';

  return (
    <div>
      <div className={centred ? 'text-center' : 'text-left'}>
        {(info.data || info.isError) && (
          <p className="text-base font-semibold tabular-nums text-fg">
            Version {info.data ? info.data.version : 'Unknown'}
          </p>
        )}
        <p className="mt-1 text-sm text-fg-secondary">{APP_DESCRIPTION}</p>
      </div>

      {info.isLoading && (
        <div className={cx('flex py-4', centred ? 'justify-center' : 'justify-start')}>
          <Spinner label="Loading app details" />
        </div>
      )}
      {info.error && (
        <Notice tone="danger" className="mt-4">
          {info.error.message}
        </Notice>
      )}
      {info.data && (
        // Runtime versions are for bug reports, so they start folded away
        <Disclosure summary="Technical details" className="mt-4">
          <dl className="space-y-1.5 rounded-lg bg-surface-subtle p-3 text-sm">
            {[
              ['Electron', info.data.electronVersion],
              ['Chrome', info.data.chromeVersion],
              ['Node.js', info.data.nodeVersion],
              ['OS', `${info.data.os} (${info.data.arch})`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-fg-secondary">{label}</dt>
                <dd className="text-right tabular-nums text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        </Disclosure>
      )}

      <div
        className={cx(
          'mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm',
          centred ? 'justify-center' : 'justify-start'
        )}
      >
        <ExternalLink href={APP_REPO_URL}>GitHub</ExternalLink>
        <ExternalLink href={APP_ISSUES_URL}>Report an issue</ExternalLink>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<FolderOpen size={16} aria-hidden="true" />}
          onClick={() => openLogs.mutate()}
        >
          Open logs folder
        </Button>
        {actions}
      </div>
      {openLogs.error && (
        <Notice tone="danger" className="mt-3">
          {openLogs.error.message}
        </Notice>
      )}
      {children && <div className="mt-4">{children}</div>}

      <p className={cx('mt-4 text-xs text-fg-muted', centred ? 'text-center' : 'text-left')}>
        MIT License
      </p>
    </div>
  );
}

export default AboutPanel;
