/**
 * WA Stay's renderer: the providers, the app-level error boundary and the route table.
 * There is no login gate (brief D2): the app opens on Explore.
 */
import type { QueryClient } from '@tanstack/react-query';
// Bundled fonts (no CDN): Figtree for UI, Fraunces (opsz + wght axes) for display.
import '@fontsource-variable/figtree';
import '@fontsource-variable/fraunces/opsz.css';
import '../styles/index.css';
import { AppProviders } from './AppProviders';
import { AppRoutes } from './AppRoutes';
import { AppErrorBoundary } from './ErrorBoundary';

export interface AppProps {
  /** Tests pass a fresh client; the app uses its one shared client. */
  queryClient?: QueryClient;
}

export default function App({ queryClient }: AppProps) {
  return (
    <AppProviders queryClient={queryClient}>
      <AppErrorBoundary>
        <AppRoutes />
      </AppErrorBoundary>
    </AppProviders>
  );
}
