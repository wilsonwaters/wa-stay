import { useState } from 'react';
import { CircleUser, Info, Settings } from 'lucide-react';
import { useHref } from 'react-router';
import { APP_NAME } from '@shared/constants';
import { IconButton, Menu, MenuItem } from '../components/ui';
import { AboutDialog } from '../features/settings/about/AboutDialog';
import { ROUTES } from './routes';

/**
 * "Account and settings": Settings and About. There is no sign-in or Logout here: WA Stay has
 * no app login (brief D2), and provider accounts arrive with V6/U4. Closing About returns focus
 * to the menu button.
 */
export function AccountMenu() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const settingsHref = useHref(ROUTES.settings());
  return (
    <>
      <Menu align="end" trigger={<IconButton label="Account and settings" icon={<CircleUser />} />}>
        <MenuItem href={settingsHref} icon={<Settings size={16} aria-hidden="true" />}>
          Settings
        </MenuItem>
        <MenuItem icon={<Info size={16} aria-hidden="true" />} onSelect={() => setAboutOpen(true)}>
          About {APP_NAME}
        </MenuItem>
      </Menu>
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  );
}

export default AccountMenu;
