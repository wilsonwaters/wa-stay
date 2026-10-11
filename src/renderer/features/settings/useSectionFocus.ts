import { useEffect, type RefObject } from 'react';
import { useLocation } from 'react-router';

/** History state of a sub-navigation link: the section's heading takes focus on arrival. */
export const SECTION_NAV_STATE = { settingsSection: true } as const;

function fromSectionNav(state: unknown): boolean {
  return (state as { settingsSection?: unknown } | null)?.settingsSection === true;
}

/**
 * Moves focus to the section's heading after a change of section from the sub-navigation (its
 * links carry `SECTION_NAV_STATE`). The page remounts per path (the route error boundary is
 * keyed by it), so the navigation, not a remembered section, says when. Arriving from
 * elsewhere, the page's `h1` takes focus as on any page.
 */
export function useSectionFocus(heading: RefObject<HTMLHeadingElement | null>) {
  const { key, state } = useLocation();
  // Once per navigation: `key` and `state` change together, only when the location does
  useEffect(() => {
    if (fromSectionNav(state)) heading.current?.focus();
  }, [key, state, heading]);
}
