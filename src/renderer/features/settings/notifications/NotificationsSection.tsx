import { DesktopSwitches } from './DesktopSwitches';
import { EmailNotifierCard } from './email/EmailNotifierCard';

/** Settings → Notifications: desktop alerts on this computer, and email. */
export function NotificationsSection() {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-semibold text-fg">On this computer</h3>
        <DesktopSwitches />
      </div>
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-semibold text-fg">Email</h3>
        <EmailNotifierCard />
      </div>
    </div>
  );
}

export default NotificationsSection;
