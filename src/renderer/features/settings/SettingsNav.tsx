import { NavLink } from 'react-router';
import { ROUTES } from '../../app/routes';
import { cx } from '../../components/ui/cx';
import { SETTINGS_SECTIONS } from './sections';
import { SECTION_NAV_STATE } from './useSectionFocus';

/**
 * Settings' sub-navigation: a labelled `nav` whose current item has `aria-current="page"`.
 * The current item is marked by weight and a sand fill, never by colour alone and never in
 * coral; the brushstroke belongs to the primary navigation.
 */
export function SettingsNav() {
  return (
    <nav aria-label="Settings sections">
      <ul className="flex flex-col gap-1">
        {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => (
          <li key={id}>
            <NavLink
              to={ROUTES.settings(id)}
              state={SECTION_NAV_STATE}
              className={({ isActive }) =>
                cx(
                  'flex h-10 items-center gap-3 rounded-md px-3 text-sm',
                  'transition-colors duration-fast ease-standard',
                  isActive
                    ? 'bg-surface-subtle font-semibold text-fg'
                    : 'font-medium text-fg-secondary hover:bg-surface-subtle hover:text-fg'
                )
              }
            >
              <Icon size={18} aria-hidden="true" className="shrink-0" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default SettingsNav;
