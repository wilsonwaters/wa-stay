import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppInfo, LaunchAtLogin } from '../../shared/contracts';
import { unwrap } from './client';
import { queryKeys } from './queryKeys';

/** Name, version and runtime details for About. They do not change while the app runs. */
export function useAppInfo(options: { enabled?: boolean } = {}) {
  return useQuery<AppInfo>({
    queryKey: queryKeys.app.info(),
    queryFn: () => unwrap((api) => api.app.getInfo()),
    staleTime: Infinity,
    enabled: options.enabled ?? true,
  });
}

/** Opens the folder holding WA Stay's log files in the system file manager. */
export function useOpenLogsFolder() {
  return useMutation({
    mutationFn: () => unwrap((api) => api.app.openLogsFolder()),
  });
}

/** Launch at login, and whether a login launch opens minimised. */
export function useLaunchAtLogin() {
  return useQuery<LaunchAtLogin>({
    queryKey: queryKeys.app.launchAtLogin(),
    queryFn: () => unwrap((api) => api.app.getAutoLaunch()),
  });
}

/**
 * Turns launch at login on or off, or changes "Start minimised". The switch moves at once; if
 * main refuses (a build running from source cannot register), it moves back and the
 * mutation's error says why.
 */
export function useSetLaunchAtLogin() {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.app.launchAtLogin();
  return useMutation({
    mutationFn: ({ enabled, startMinimised }: { enabled: boolean; startMinimised?: boolean }) =>
      unwrap((api) => api.app.setAutoLaunch(enabled, startMinimised)),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<LaunchAtLogin>(queryKey);
      if (previous) queryClient.setQueryData<LaunchAtLogin>(queryKey, { ...previous, ...next });
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSuccess: (saved) => queryClient.setQueryData(queryKey, saved),
  });
}
