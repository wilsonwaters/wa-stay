import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  settingDefault,
  type SettingKey,
  type SettingValue,
  type WritableSettingKey,
} from '../../shared/contracts/settings';
import { unwrap } from './client';
import { queryKeys } from './queryKeys';

/**
 * One typed setting (architecture-notes §12.7). Main answers the key's default while nothing
 * is stored; an empty answer falls back to the same default here. `value` is the default
 * until the stored value has loaded, so read `isPending` before trusting it.
 */
export function useSetting<K extends SettingKey>(key: K) {
  const query = useQuery({
    queryKey: queryKeys.settings.value(key),
    queryFn: async () => {
      const value = await unwrap((api) => api.settings.get(key));
      return (value ?? settingDefault(key)) as SettingValue<K>;
    },
  });
  return { ...query, value: query.data ?? settingDefault(key) };
}

/**
 * Saves a renderer-writable setting. The new value shows at once; a failed save puts the old
 * one back (and the mutation's error says why).
 */
export function useSetSetting<K extends WritableSettingKey>(key: K) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.settings.value(key);
  return useMutation({
    mutationFn: (value: SettingValue<K>) => unwrap((api) => api.settings.set(key, value)),
    onMutate: async (value: SettingValue<K>) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<SettingValue<K>>(queryKey);
      queryClient.setQueryData(queryKey, value);
      return { previous };
    },
    onError: (_error, _value, context) => {
      queryClient.setQueryData(queryKey, context?.previous ?? settingDefault(key));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
}
