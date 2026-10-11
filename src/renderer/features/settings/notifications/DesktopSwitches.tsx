import { useSetSetting, useSetting } from '../../../api';
import { Switch, useAnnounce, useToast } from '../../../components/ui';

/**
 * Desktop notifications and their sound (`notifications.desktop`, `notifications.sound`).
 * They apply at once: main reads them on every notification. Sound is the OS notification's
 * own, so it needs desktop notifications.
 */
export function DesktopSwitches() {
  const desktop = useSetting('notifications.desktop');
  const sound = useSetting('notifications.sound');
  const setDesktop = useSetSetting('notifications.desktop');
  const setSound = useSetSetting('notifications.sound');
  const announce = useAnnounce();
  const toast = useToast();

  const save = (mutation: typeof setDesktop | typeof setSound, name: string) => (on: boolean) =>
    mutation.mutate(on, {
      onSuccess: () => announce(`${name} ${on ? 'on' : 'off'}`),
      onError: () => toast.error("Couldn't save that setting. Try again."),
    });

  return (
    <div className="flex flex-col divide-y divide-border">
      <Switch
        className="pb-5"
        label="Desktop notifications"
        description={
          desktop.value
            ? 'Pop-up alerts on your desktop when a watch finds a site or a site is held. Everything also appears under the bell.'
            : "Pop-up alerts are off. Held sites expire quickly; you'll only see them in WA Stay or by email."
        }
        checked={desktop.value}
        disabled={desktop.isPending}
        onChange={(event) => save(setDesktop, 'Desktop notifications')(event.target.checked)}
      />
      <Switch
        className="pt-5"
        label="Play a sound"
        description={
          desktop.value
            ? "Uses your system's notification sound."
            : 'Requires desktop notifications.'
        }
        checked={sound.value}
        disabled={!desktop.value || sound.isPending}
        onChange={(event) => save(setSound, 'Sound')(event.target.checked)}
      />
    </div>
  );
}

export default DesktopSwitches;
