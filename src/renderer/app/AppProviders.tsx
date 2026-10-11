import { useEffect, type ReactNode } from 'react';
import { HashRouter } from 'react-router';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { LucideProvider } from 'lucide-react';
import { toApiError, useProviders } from '../api';
import {
  AnnouncerProvider,
  ProviderManifestsProvider,
  ToastProvider,
  useToast,
  type ProviderBadgeInfo,
} from '../components/ui';
import { queryClient as appQueryClient } from './queryClient';

const NO_MANIFESTS: readonly ProviderBadgeInfo[] = [];

/**
 * Fills `ProviderManifestsProvider` from `providers.list()`, so a `ProviderBadge` needs only a
 * `providerId`. If the list cannot be loaded the app carries on (badges show their unknown
 * variant) and one error toast says so. Outside the app there is no list to load, and the
 * shell's own notice already says why, so no toast.
 */
function ProviderManifests({ children }: { children: ReactNode }) {
  const { data, error } = useProviders();
  const toast = useToast();
  useEffect(() => {
    if (!error) return;
    const apiError = toApiError(error);
    if (apiError.code !== 'API_UNAVAILABLE') {
      toast.error(`Provider details couldn't be loaded. ${apiError.message}`);
    }
  }, [error, toast]);
  return (
    <ProviderManifestsProvider manifests={data ?? NO_MANIFESTS}>
      {children}
    </ProviderManifestsProvider>
  );
}

export interface AppProvidersProps {
  children: ReactNode;
  /** Tests pass a fresh client; the app uses its one shared client. */
  queryClient?: QueryClient;
}

/**
 * Everything the app runs inside: the hash router (production loads `file://`), React Query,
 * one icon style, toasts, live announcements and the provider manifests.
 */
export function AppProviders({ children, queryClient = appQueryClient }: AppProvidersProps) {
  return (
    <HashRouter>
      <QueryClientProvider client={queryClient}>
        <LucideProvider strokeWidth={1.75} size={20}>
          <ToastProvider>
            <AnnouncerProvider>
              <ProviderManifests>{children}</ProviderManifests>
            </AnnouncerProvider>
          </ToastProvider>
        </LucideProvider>
      </QueryClientProvider>
    </HashRouter>
  );
}

export default AppProviders;
