import { useRef, useState } from 'react';
import {
  toApiError,
  useAccountStatus,
  useDeleteSnipe,
  useOpenSnipePayment,
  useRunSnipeNow,
  useSetSnipeActive,
} from '../../../api';
import { SnipeResult } from '../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe, SnipeExecutionResult } from '../../../../shared/types/site-sniper.types';
import { HOLD_EXPIRED_MESSAGE } from '../../../components/stay/HoldPanel';
import { useToast } from '../../../components/ui';
import { unitLabel, unitNounFor } from './snipeState';

/** What one attempt found, for the toast that announces it. */
export function runResultMessage(
  result: SnipeExecutionResult,
  snipe: SiteSnipe,
  manifest: ProviderManifest | undefined,
  unitNames?: ReadonlyMap<string, string>
): string {
  const place = snipe.location.name || snipe.name;
  const provider = manifest?.shortName ?? 'the provider';
  if (result.held) {
    const unit = unitLabel(result.matchedSiteId, unitNounFor(manifest), unitNames);
    return `${unit} held at ${place}. Pay on ${provider} to keep it.`;
  }
  if (!result.success) return result.error ?? `The attempt at ${place} failed. Try again soon.`;
  switch (result.result) {
    case SnipeResult.TOO_EARLY:
      return `${place} isn't released yet. Site Sniper tries again at the release.`;
    case SnipeResult.UNAVAILABLE:
      return `Nothing free at ${place} yet.`;
    case SnipeResult.QUEUE_FULL:
      return `${provider}'s queue is full. Site Sniper keeps trying.`;
    default:
      return result.error ?? `Tried ${place}.`;
  }
}

/**
 * The actions a snipe offers wherever it is shown (card, detail), each telling the outcome in a
 * toast. Arming a snipe of a provider whose holds need an account, while signed out, opens the
 * Connect prompt instead (`connectOpen`), as does main refusing it for that (`AUTH_REQUIRED`,
 * when the recorded account was stale; §12.32). `unitNames` names a unit Run now holds.
 */
export function useSnipeActions(
  snipe: SiteSnipe,
  manifest: ProviderManifest | undefined,
  unitNames?: ReadonlyMap<string, string>
) {
  const toast = useToast();
  const setActive = useSetSnipeActive();
  const run = useRunSnipeNow();
  const pay = useOpenSnipePayment();
  const remove = useDeleteSnipe();
  const account = useAccountStatus(manifest?.id);
  const [connectOpen, setConnectOpen] = useState(false);
  const running = useRef(false);
  const requirement = manifest?.capabilities.account;
  const needsAccount =
    (requirement === 'required' || requirement === 'required-for-holds') &&
    account.data?.status !== 'signed-in';

  const setArmed = (active: boolean) =>
    setActive.mutate(
      { id: snipe.id, active },
      {
        onSuccess: () => toast.success(active ? `Armed ${snipe.name}` : `Disarmed ${snipe.name}`),
        onError: (error) => {
          if (active && manifest && toApiError(error).code === 'AUTH_REQUIRED')
            setConnectOpen(true);
          else toast.error(error.message);
        },
      }
    );

  const arm = () => {
    if (needsAccount) setConnectOpen(true);
    else setArmed(true);
  };

  const runNow = () => {
    if (running.current) return;
    running.current = true;
    run.mutate(snipe.id, {
      onSuccess: (result) => {
        const message = runResultMessage(result, snipe, manifest, unitNames);
        if (result.success) toast.success(message);
        else toast.error(message);
      },
      onError: (error) => toast.error(`${snipe.name} couldn't be tried. ${error.message}`),
      onSettled: () => {
        running.current = false;
      },
    });
  };

  const payNow = () =>
    pay.mutate(snipe.id, {
      onError: (error) =>
        toast.error(
          toApiError(error).code === 'HOLD_EXPIRED'
            ? HOLD_EXPIRED_MESSAGE
            : `The payment page couldn't be opened. ${error.message}`
        ),
    });

  /** For a ConfirmDialog: resolves once deleted (a rejection keeps the dialog open). */
  const deleteSnipe = async () => {
    await remove.mutateAsync(snipe.id);
    toast.success('Snipe deleted');
  };

  return {
    arm,
    arming: setActive.isPending && setActive.variables?.active === true,
    disarm: () => setArmed(false),
    disarming: setActive.isPending && setActive.variables?.active === false,
    runNow,
    running: run.isPending,
    payNow,
    paying: pay.isPending,
    deleteSnipe,
    needsAccount,
    connectOpen,
    closeConnect: () => setConnectOpen(false),
    armAfterConnect: () => {
      setConnectOpen(false);
      setArmed(true);
    },
  };
}

export type SnipeActions = ReturnType<typeof useSnipeActions>;
