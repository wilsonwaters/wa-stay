import { useRef, type ComponentType } from 'react';
import { Navigate, useLocation, useParams } from 'react-router';
import { ROUTES } from '../../app/routes';
import { PageHeader } from '../../components/ui';
import { AccountsSection } from './accounts/AccountsSection';
import { AboutSection } from './about/AboutSection';
import { AppSection } from './app/AppSection';
import { NotificationsSection } from './notifications/NotificationsSection';
import { SettingsNav } from './SettingsNav';
import {
  DEFAULT_SETTINGS_SECTION,
  isSettingsSection,
  settingsSection,
  type SettingsSectionId,
} from './sections';
import { useSectionFocus } from './useSectionFocus';

const SECTION_CONTENT: Record<SettingsSectionId, ComponentType> = {
  accounts: AccountsSection,
  notifications: NotificationsSection,
  app: AppSection,
  about: AboutSection,
};

/**
 * Settings (`/settings/:section`): a sub-navigation and one section at a time, each its own
 * route. `/settings` and an unknown section go to Accounts, keeping the query string
 * (`?provider=<id>`).
 */
export function SettingsPage() {
  const { section } = useParams<{ section?: string }>();
  const { search } = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  useSectionFocus(heading);

  if (!isSettingsSection(section)) {
    return (
      <Navigate to={{ pathname: ROUTES.settings(DEFAULT_SETTINGS_SECTION), search }} replace />
    );
  }

  const { heading: title, description } = settingsSection(section);
  const Content = SECTION_CONTENT[section];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8 lg:px-8">
      <PageHeader title="Settings" />
      {/* Two columns from md: the smallest window (960 px, less its frame) always has them;
          only zooming in stacks the sub-navigation above the section */}
      <div className="grid gap-8 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10 lg:gap-12">
        <SettingsNav />
        {/* Not a landmark: "Notifications" would clash with the tray's toast region */}
        <div className="min-w-0 max-w-2xl">
          <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold text-fg">
            {title}
          </h2>
          <p className="mt-1 text-sm text-fg-secondary">{description}</p>
          <div className="mt-6">
            <Content />
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
