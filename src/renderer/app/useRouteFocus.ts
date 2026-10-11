import { useEffect, useRef, type RefObject } from 'react';
import { useLocation } from 'react-router';
import { useAnnounce } from '../components/ui';
import { pageTitleFor, routeFocusKey } from './routes';

/** How long a page that is still loading may take to show its `h1` and still get focus. */
export const HEADING_WAIT_MS = 2000;

function focusHeading(heading: HTMLElement) {
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus();
}

/**
 * After every page change (pathname, not just the query string; Settings' sections count as one
 * page, `routeFocusKey`), moves focus to the new page's `h1`, or to `<main>` when it has none
 * yet, and announces the page title politely. The first page is left alone, so the first Tab
 * still reaches "Skip to content". A page that moves focus inside `<main>` itself before then
 * (Settings → Accounts focusing the row a link asked for) keeps it; the title is still
 * announced.
 *
 * Pages that load before they show their heading get a short grace period: if the `h1` turns up
 * while focus is still on `<main>` (or was lost to the body), focus moves to it. The same holds
 * when a page replaces the `h1` it showed first (a page that shows its heading, then a spinner,
 * then the heading again): focus lost with the old one follows the new one.
 */
export function useRouteFocus(mainRef: RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation();
  const page = routeFocusKey(pathname);
  // Read for the announcement only: a new path on the same page moves nothing
  const latestPath = useRef(pathname);
  latestPath.current = pathname;
  const announce = useAnnounce();
  // The page focus was last moved for. Comparing pages (rather than a "first run" flag) keeps the
  // first page alone under StrictMode too, where effects run twice on mount.
  const settledPage = useRef(page);

  useEffect(() => {
    if (settledPage.current === page) return undefined;
    settledPage.current = page;

    // Focus the new page moves inside <main> before the frame below is its own choice: kept.
    // Its effects run before this one, so it may already have moved it.
    const isInPage = (element: Element | null): element is Element => {
      const main = mainRef.current;
      return Boolean(main && element && element !== main && main.contains(element));
    };
    let placed: Element | null = isInPage(document.activeElement) ? document.activeElement : null;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Element | null;
      if (isInPage(target)) placed = target;
    };
    document.addEventListener('focusin', onFocusIn);

    let observer: MutationObserver | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // Wait a frame so the new page has rendered; a newer navigation cancels it, so only the
    // last page of a quick run of navigations takes focus.
    const frame = requestAnimationFrame(() => {
      document.removeEventListener('focusin', onFocusIn);
      const main = mainRef.current;
      if (!main) return;
      const heading = main.querySelector('h1');
      const keep = placed !== null && placed === document.activeElement;
      if (!keep) {
        if (heading) focusHeading(heading);
        else main.focus();
      }
      announce(heading?.textContent?.trim() || pageTitleFor(latestPath.current));
      if (keep) return;

      observer = new MutationObserver(() => {
        const late = main.querySelector('h1');
        const active = document.activeElement;
        if (!late || late === active) return;
        if (active === main || active === document.body || active === null) focusHeading(late);
      });
      observer.observe(main, { childList: true, subtree: true });
      timeout = setTimeout(() => observer?.disconnect(), HEADING_WAIT_MS);
    });

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', onFocusIn);
      observer?.disconnect();
      if (timeout) clearTimeout(timeout);
    };
  }, [page, mainRef, announce]);
}
