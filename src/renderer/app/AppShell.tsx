import { Suspense, useRef, useState, type MouseEvent } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { API_UNAVAILABLE_MESSAGE, isApiAvailable } from '../api';
import { Logo } from '../components/brand/Logo';
import { Notice, Spinner } from '../components/ui';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { useAppNavigate } from '../features/notifications/useAppNavigate';
import { AccountMenu } from './AccountMenu';
import { RouteErrorBoundary } from './ErrorBoundary';
import { ROUTES } from './routes';
import { TopNav } from './TopNav';
import { Tray } from './Tray';
import { useRouteFocus } from './useRouteFocus';

/**
 * The frame around every page: a 64 px sticky header (logo, primary nav, notifications, account
 * menu), the routed page in `<main id="main">`, and the floating tray. Anatomy and stable names:
 * docs/design/shell.md.
 */
export function AppShell() {
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  // Outside the app (a plain browser on the Vite dev server) there is no main process: the
  // bell is left out (it has nothing to count), and a Notice says why.
  const apiAvailable = isApiAvailable();
  // The open notification list and the tray share the bottom-right corner on short windows.
  const [listOpen, setListOpen] = useState(false);
  useRouteFocus(mainRef);
  // A click on a desktop notification opens its page (main sends `app:navigate`).
  useAppNavigate();

  // A plain `#main` link would change the HashRouter route, so move focus by hand.
  const skipToContent = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    mainRef.current?.focus();
  };

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <header className="sticky top-0 z-header h-16 border-b border-border bg-surface">
        <div className="relative flex h-full items-center gap-3 px-4 sm:gap-6 sm:px-6 lg:px-8">
          <a
            href="#main"
            onClick={skipToContent}
            // `not-sr-only` resets padding, so the padding goes on the focus variant too.
            className="sr-only rounded-md bg-surface text-sm font-semibold text-fg shadow-pop focus:not-sr-only focus:absolute focus:left-4 focus:top-3.5 focus:px-3 focus:py-2"
          >
            Skip to content
          </a>
          <Link to={ROUTES.explore()} aria-label="WA Stay, Explore" className="shrink-0 rounded-md">
            {/* Below 640 px (a zoomed-in window) the square mark leaves the nav more room. */}
            <Logo variant="lockup" decorative className="h-8 w-auto max-sm:hidden" />
            <Logo variant="mark" decorative className="h-8 w-8 sm:hidden" />
          </Link>
          <TopNav />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {apiAvailable && <NotificationBell onOpenChange={setListOpen} />}
            <AccountMenu />
          </div>
        </div>
      </header>

      <main id="main" ref={mainRef} tabIndex={-1} className="focus:outline-hidden">
        {!apiAvailable && (
          <div className="mx-auto w-full max-w-7xl px-6 pt-6 lg:px-8">
            <Notice tone="warning" title="Running outside the WA Stay app">
              {API_UNAVAILABLE_MESSAGE}
            </Notice>
          </div>
        )}
        <RouteErrorBoundary key={pathname}>
          <Suspense
            fallback={
              <div className="flex justify-center py-24">
                <Spinner size="lg" label="Loading page" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </RouteErrorBoundary>
      </main>

      <Tray setAside={listOpen} />
    </div>
  );
}

export default AppShell;
