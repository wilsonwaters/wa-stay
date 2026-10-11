/**
 * The renderer's data layer: React Query hooks over `window.api`. Components use these and
 * never call `window.api` themselves (architecture-notes §8).
 */

export {
  API_UNAVAILABLE_MESSAGE,
  ApiError,
  getApi,
  isApiAvailable,
  toApiError,
  unwrap,
  type ApiErrorCode,
} from './client';
export { queryKeys } from './queryKeys';
export { useApiEvent, useInvalidateOn, type InvalidateOnOptions } from './events';
export { useAppInfo, useLaunchAtLogin, useOpenLogsFolder, useSetLaunchAtLogin } from './app';
export {
  useAccountCheck,
  useAccounts,
  useAccountStatus,
  useOpenSignInLink,
  useSignIn,
  useSignOut,
} from './accounts';
export {
  useConfigureEmailNotifier,
  useEmailNotifier,
  useSetEmailNotifierEnabled,
  useTestEmailNotifier,
  type EmailNotifierView,
} from './notifiers';
export { useSetSetting, useSetting } from './settings';
export {
  useAccessStatus,
  useProvider,
  useProviders,
  useProvidersWith,
  type ProviderCapabilities,
  type ProviderCapability,
  type ProviderManifest,
} from './providers';
export {
  NOTIFICATION_LIST_LIMIT,
  useClearNotifications,
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationUpdates,
  useNotifications,
  useUnreadNotificationCount,
} from './notifications';
export {
  useCheckForUpdates,
  useDownloadUpdate,
  useInstallUpdate,
  type UpdateCheckOutcome,
} from './updater';
export {
  BULK_AVAILABILITY_GC_TIME_MS,
  BULK_AVAILABILITY_STALE_TIME_MS,
  CATALOG_STALE_TIME_MS,
  LOCATION_CHECK_STALE_TIME_MS,
  LOCATION_DETAIL_STALE_TIME_MS,
  LOCATION_SEARCH_LIMIT,
  LOCATION_SEARCH_MIN_CHARS,
  LOCATION_SEARCH_PENDING_MAX_MS,
  LOCATION_SEARCH_PENDING_POLL_MS,
  normaliseCatalogQuery,
  stayKey,
  useBulkAvailability,
  useCatalogAll,
  useCatalogAreaSearch,
  useCatalogPlaces,
  useCatalogRefresh,
  useCatalogSearch,
  useCatalogStatus,
  useCatalogUpdates,
  useLocationCheck,
  useLocationDetail,
  useLocationDetailUpdates,
  useLocationSearch,
  useOpenLocationDocument,
  type BulkAvailability,
  type BulkAvailabilityStatus,
} from './catalog';
export {
  WATCH_EVENT_COALESCE_MS,
  useCreateWatch,
  useDeleteWatch,
  useOpenWatchPayment,
  useRunWatchNow,
  useSetWatchActive,
  useUpdateWatch,
  useWatch,
  useWatches,
  useWatchUpdates,
} from './watches';
export {
  useBooking,
  useBookings,
  useBookingUpdates,
  useCreateBooking,
  useDeleteBooking,
  useImportBooking,
} from './bookings';
export {
  SNIPE_EVENT_COALESCE_MS,
  useCreateSnipe,
  useDeleteSnipe,
  useOpenSnipePayment,
  useRunSnipeNow,
  useSetSnipeActive,
  useSnipe,
  useSnipes,
  useSnipeUpdates,
} from './snipes';
