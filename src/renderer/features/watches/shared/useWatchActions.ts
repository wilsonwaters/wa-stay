import { useRef } from 'react';
import {
  toApiError,
  useDeleteWatch,
  useOpenWatchPayment,
  useRunWatchNow,
  useSetWatchActive,
} from '../../../api';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { Watch } from '../../../../shared/types/watch.types';
import { HOLD_EXPIRED_MESSAGE } from '../../../components/stay/HoldPanel';
import { useToast } from '../../../components/ui';
import { runResultMessage } from './resultSummary';
import { unitNounFor } from './watchState';

/**
 * The actions a watch offers wherever it is shown (card, detail, edit), each telling the
 * outcome in a toast: the toast region is a polite live region, so Check now's result is
 * announced ("3 sites available at Osprey Bay").
 */
export function useWatchActions(watch: Watch, manifest: ProviderManifest | undefined) {
  const toast = useToast();
  const run = useRunWatchNow();
  const setActive = useSetWatchActive();
  const pay = useOpenWatchPayment();
  const remove = useDeleteWatch();
  // One check at a time, even from a double-click before the button shows it is busy.
  const checking = useRef(false);

  const checkNow = () => {
    if (checking.current) return;
    checking.current = true;
    run.mutate(watch.id, {
      onSuccess: (result) => {
        const message = runResultMessage(result, watch, unitNounFor(manifest), manifest);
        if (result.success) toast.success(message);
        else toast.error(message);
      },
      onError: (error) => toast.error(`${watch.name} couldn't be checked. ${error.message}`),
      onSettled: () => {
        checking.current = false;
      },
    });
  };

  const setWatching = (active: boolean) =>
    setActive.mutate(
      { id: watch.id, active },
      {
        onSuccess: () =>
          toast.success(active ? `Watching ${watch.name} again` : `Paused ${watch.name}`),
        onError: (error) => toast.error(error.message),
      }
    );

  const payNow = () =>
    pay.mutate(watch.id, {
      onError: (error) =>
        toast.error(
          toApiError(error).code === 'HOLD_EXPIRED' ? HOLD_EXPIRED_MESSAGE : error.message
        ),
    });

  /** For a ConfirmDialog: resolves once deleted (rejects keep the dialog open with the error). */
  const deleteWatch = async () => {
    await remove.mutateAsync(watch.id);
    toast.success('Watch deleted');
  };

  return {
    checkNow,
    checking: run.isPending,
    pause: () => setWatching(false),
    resume: () => setWatching(true),
    payNow,
    paying: pay.isPending,
    deleteWatch,
  };
}

export type WatchActions = ReturnType<typeof useWatchActions>;
