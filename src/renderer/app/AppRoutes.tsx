/**
 * The route table (architecture-notes §12.10). Addresses are built with `ROUTES` from
 * `./routes`; docs/design/shell.md lists every route and what renders it.
 *
 * (It is not called `routes.tsx`: `./routes` would then be ambiguous, and every tool resolves
 * it to `routes.ts` first.)
 */
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Spinner } from '../components/ui';
import ExplorePage from '../features/explore/ExplorePage';
import PlaceDetailPage from '../features/place/PlaceDetailPage';
import { WatchesPage } from '../features/watches/WatchesPage';
import { NewWatchPage } from '../features/watches/create/NewWatchPage';
import { WatchDetailPage } from '../features/watches/detail/WatchDetailPage';
import { EditWatchPage } from '../features/watches/edit/EditWatchPage';
import { SnipesPage } from '../features/snipes/SnipesPage';
import { NewSnipePage } from '../features/snipes/create/NewSnipePage';
import { SnipeDetailPage } from '../features/snipes/detail/SnipeDetailPage';
import { BookingsPage } from '../features/bookings/BookingsPage';
import { BookingDetailPage } from '../features/bookings/detail/BookingDetailPage';
import SettingsPage from '../features/settings/SettingsPage';
import { AppShell } from './AppShell';
import { NotFoundPage } from './NotFoundPage';
import { LEGACY_REDIRECTS, PATTERNS } from './routes';

// Vite replaces `process.env.NODE_ENV` in renderer code; Jest runs on Node (as in ui/dev.ts).
declare const process: { env: { NODE_ENV?: string } };

// Dev-only design preview. The constant condition lets Vite drop the page and its chunk from
// production builds.
const DesignPreviewPage =
  process.env.NODE_ENV !== 'production'
    ? lazy(() => import('../features/design-preview/DesignPreviewPage'))
    : null;

/** Sends an old create address to its new one, keeping the prefill query (§12.10, §12.19). */
function RedirectKeepingQuery({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path={PATTERNS.explore} element={<ExplorePage />} />
        <Route path={PATTERNS.placeDetail} element={<PlaceDetailPage />} />

        <Route path={PATTERNS.watches} element={<WatchesPage />} />
        <Route path={PATTERNS.watchNew} element={<NewWatchPage />} />
        <Route path={PATTERNS.watchDetail} element={<WatchDetailPage />} />
        <Route path={PATTERNS.watchEdit} element={<EditWatchPage />} />

        <Route path={PATTERNS.snipes} element={<SnipesPage />} />
        <Route path={PATTERNS.snipeNew} element={<NewSnipePage />} />
        <Route path={PATTERNS.snipeDetail} element={<SnipeDetailPage />} />

        <Route path={PATTERNS.bookings} element={<BookingsPage />} />
        <Route path={PATTERNS.bookingDetail} element={<BookingDetailPage />} />

        {/* `/settings` and an unknown section go to Accounts */}
        <Route path={PATTERNS.settings} element={<SettingsPage />} />

        {LEGACY_REDIRECTS.map(({ from, to }) => (
          <Route key={from} path={from} element={<RedirectKeepingQuery to={to} />} />
        ))}

        <Route path="*" element={<NotFoundPage />} />
      </Route>

      {DesignPreviewPage && (
        // Outside the shell: the gallery is a whole page with its own header and main.
        <Route
          path={PATTERNS.design}
          element={
            <Suspense
              fallback={
                <div className="flex min-h-screen items-center justify-center">
                  <Spinner size="lg" label="Loading design preview" />
                </div>
              }
            >
              <DesignPreviewPage />
            </Suspense>
          }
        />
      )}
    </Routes>
  );
}

export default AppRoutes;
