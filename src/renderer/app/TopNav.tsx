import { Link, matchPath, useLocation } from 'react-router';
import { Badge, Brushstroke, VisuallyHidden } from '../components/ui';
import { PATTERNS, ROUTES } from './routes';

interface NavItem {
  label: string;
  to: string;
  /** Route patterns under which this item is the current page. */
  current: string[];
  /** Still being finished: navigable, with a "Soon" pill and ", coming soon" in its name. */
  soon?: boolean;
}

/** The primary navigation (architecture-notes §8). Settings lives in the account menu. */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Explore', to: ROUTES.explore(), current: [PATTERNS.explore, '/places/*'] },
  { label: 'Watches', to: ROUTES.watches(), current: [`${PATTERNS.watches}/*`] },
  { label: 'Site Sniper', to: ROUTES.snipes(), current: [`${PATTERNS.snipes}/*`], soon: true },
  { label: 'Bookings', to: ROUTES.bookings(), current: [`${PATTERNS.bookings}/*`], soon: true },
];

export function isCurrent(item: NavItem, pathname: string): boolean {
  return item.current.some((pattern) => matchPath(pattern, pathname) !== null);
}

function NavLinkItem({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      to={item.to}
      aria-current={active ? 'page' : undefined}
      className={`relative inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm hover:bg-surface-subtle ${
        active ? 'text-fg' : 'text-fg-secondary hover:text-fg'
      }`}
    >
      {/* The bold copy reserves the active width, so the nav never shifts as the page changes.
          A Soon item's name comes whole from its hidden text, so it reads "Site Sniper, coming
          soon" exactly, with no separator between the label and the rest. */}
      <span className="relative inline-grid" aria-hidden={item.soon ? true : undefined}>
        <span className={`col-start-1 row-start-1 ${active ? 'font-semibold' : 'font-medium'}`}>
          {item.label}
        </span>
        <span aria-hidden="true" className="invisible col-start-1 row-start-1 font-semibold">
          {item.label}
        </span>
        {/* Under the label only (not the Soon pill), stretched to its width. An absolutely
            positioned SVG takes no width from left/right (it is a replaced element), so it gets
            w-full; the stroke has preserveAspectRatio="none", so it follows the label. */}
        {active && (
          <Brushstroke
            variant="underline"
            tone="ocean"
            className="pointer-events-none absolute left-0 top-full mt-1.5 h-2 w-full"
          />
        )}
      </span>
      {item.soon && (
        <>
          <VisuallyHidden>{`${item.label}, coming soon`}</VisuallyHidden>
          {/* Below 900 px (narrow windows, 200% zoom) only the hidden text remains. */}
          <span aria-hidden="true" className="max-[899px]:hidden">
            <Badge tone="sun">Soon</Badge>
          </span>
        </>
      )}
    </Link>
  );
}

/** "Explore", "Watches", "Site Sniper, coming soon", "Bookings, coming soon". */
export function TopNav() {
  const { pathname } = useLocation();
  return (
    // If the window is too narrow for the nav (high zoom), the strip scrolls sideways on its own
    // and the page never does. The scrollbar is hidden: Tab scrolls a focused link into view.
    <nav
      aria-label="Primary"
      className="h-full min-w-0 overflow-x-auto [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex h-full items-center gap-1 px-1">
        {NAV_ITEMS.map((item) => (
          <li key={item.label}>
            <NavLinkItem item={item} active={isCurrent(item, pathname)} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default TopNav;
