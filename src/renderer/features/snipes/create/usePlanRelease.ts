import { useMemo } from 'react';
import { useStayRules } from '../../../api';
import type { ProviderManifest, StayQuery } from '../../../../shared/types/provider.types';
import { toStayParams } from '../../../components/stay/stayFields';
import { remindsOnly } from './snipeAction';
import { snipeStayFields, type SnipeFormValues } from './snipeForm';

/** Why a plan can't be made for a stay already on sale (as main refuses it). */
export const PLAN_ON_SALE = (shortName: string) =>
  `These dates are already on sale: book them on ${shortName} now, or set a watch for a cancellation.`;

export interface PlanRelease {
  /** The release a plan reminds before (its Open Day), when the stay is not on sale yet. */
  releaseAt?: Date;
  /** The release in the provider's words ("Opens Wed 4 Nov 2026, 8:30 am, …"), once known. */
  text?: string;
  /** Why no plan can be made for the stay: on sale already, or refused by the booking rules. */
  refused?: string;
  /** Still working it out. */
  loading: boolean;
}

type PlanValues = Pick<
  SnipeFormValues,
  | 'location'
  | 'arrival'
  | 'departure'
  | 'adults'
  | 'children'
  | 'infants'
  | 'stayParams'
  | 'unitIds'
  | 'unitKinds'
  | 'releaseMode'
>;

/**
 * What the provider's booking rules say about the form's stay (`catalog.stayRules`, for its
 * units and stay types), worked out in main without asking the provider: `null` for a provider
 * without rules. One query for the Stay and Release steps. Asks only while `enabled`.
 */
export function useSnipeStayRules(
  manifest: ProviderManifest | undefined,
  values: Omit<PlanValues, 'releaseMode'>,
  enabled = true
) {
  const { location, arrival, departure, adults, children, infants, stayParams } = values;
  const params = useMemo(
    () => toStayParams(snipeStayFields(manifest), stayParams),
    [manifest, stayParams]
  );
  const stay = useMemo<StayQuery | null>(
    () =>
      arrival && departure
        ? {
            arrival,
            departure,
            adults,
            ...(children > 0 ? { children } : {}),
            ...(infants > 0 ? { infants } : {}),
            ...(Object.keys(params).length ? { params } : {}),
          }
        : null,
    [arrival, departure, adults, children, infants, params]
  );
  const key = enabled && manifest && location ? `${manifest.id}:${location.externalId}` : null;
  return useStayRules(key, stay, { unitIds: values.unitIds, unitKinds: values.unitKinds });
}

/**
 * When an Open Day plan's stay goes on sale (§12.38), from the provider's booking rules
 * (`useSnipeStayRules`), so the person sees the Open Day, and so when the reminders come,
 * before the plan is made. Asks only while `enabled` and in a mode that only reminds.
 */
export function usePlanRelease(
  manifest: ProviderManifest | undefined,
  values: PlanValues,
  enabled = true
): PlanRelease {
  const wanted = enabled && remindsOnly(manifest, values.releaseMode);
  const rules = useSnipeStayRules(manifest, values, wanted);
  const asked = wanted && values.location && values.arrival && values.departure;
  const verdict = rules.data;
  if (!manifest || !asked || rules.isError || verdict === null) return { loading: false };
  if (!verdict) return { loading: true };
  // Main's answer crosses IPC: only text and a real instant are used
  const text = typeof verdict.release?.text === 'string' ? verdict.release.text : undefined;
  if (!verdict.ok) return { refused: verdict.reason, text, loading: false };
  const opensAt = verdict.release?.opensAt ? new Date(verdict.release.opensAt) : undefined;
  if (verdict.release?.open || !opensAt || Number.isNaN(opensAt.getTime())) {
    return { refused: PLAN_ON_SALE(manifest.shortName), text, loading: false };
  }
  return { releaseAt: opensAt, text, loading: false };
}
