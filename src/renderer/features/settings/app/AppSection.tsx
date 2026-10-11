import { useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { useLaunchAtLogin, useSetLaunchAtLogin } from '../../../api';
import { Button, Notice, Skeleton, Switch, useAnnounce } from '../../../components/ui';

/**
 * Settings → App: how WA Stay starts. Launch at login is an OS entry that only the installed
 * app can register; a refusal shows its reason under the switch, which goes back to off. Where
 * the OS cannot start apps at sign-in (Linux) both switches are unavailable, and say so.
 * "Start minimised" opens the window minimised to the taskbar on a login launch (there is no
 * tray: closing the window quits WA Stay).
 */
export function AppSection() {
  const launch = useLaunchAtLogin();
  const setLaunch = useSetLaunchAtLogin();
  const announce = useAnnounce();
  const [error, setError] = useState<string | null>(null);

  if (launch.isPending) {
    return (
      <div aria-busy="true">
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }
  if (launch.isError) {
    return (
      <Notice
        tone="danger"
        title="Start-up settings couldn't be loaded"
        actions={
          <Button variant="secondary" size="sm" onClick={() => void launch.refetch()}>
            Try again
          </Button>
        }
      >
        {launch.error.message}
      </Notice>
    );
  }

  const { enabled, startMinimised } = launch.data;
  // Linux: the OS cannot start WA Stay at sign-in, so nothing can be switched on
  const supported = launch.data.supported !== false;
  const save = (next: { enabled: boolean; startMinimised?: boolean }, said: string) => {
    setError(null);
    setLaunch.mutate(next, {
      onSuccess: () => announce(said),
      onError: (failure) => setError(failure.message),
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col divide-y divide-border">
        <div className="flex flex-col gap-2 pb-5">
          <Switch
            label="Start WA Stay when you sign in"
            description={
              supported
                ? 'WA Stay checks your watches only while it is running. Starting it when you sign in to your computer keeps them going after a restart.'
                : 'Available on Windows and macOS only. WA Stay checks your watches only while it is running.'
            }
            aria-describedby={error ? 'launch-at-login-error' : undefined}
            aria-invalid={error ? true : undefined}
            checked={enabled}
            disabled={!supported || setLaunch.isPending}
            onChange={(event) => {
              const on = event.target.checked;
              save({ enabled: on }, `Start when you sign in ${on ? 'on' : 'off'}`);
            }}
          />
          {error && (
            <p
              id="launch-at-login-error"
              role="alert"
              className="flex items-start gap-1.5 text-sm font-medium text-danger"
            >
              <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
        </div>
        <Switch
          className="pt-5"
          label="Start minimised"
          description={
            enabled
              ? 'Opens in the taskbar instead of on screen.'
              : 'Requires starting WA Stay when you sign in.'
          }
          checked={startMinimised}
          disabled={!supported || !enabled || setLaunch.isPending}
          onChange={(event) => {
            const on = event.target.checked;
            save({ enabled: true, startMinimised: on }, `Start minimised ${on ? 'on' : 'off'}`);
          }}
        />
      </div>
      <p className="max-w-prose text-sm text-fg-muted">
        Closing the WA Stay window quits it; watches stop until you open it again.
      </p>
    </div>
  );
}

export default AppSection;
