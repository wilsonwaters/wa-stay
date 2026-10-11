import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  clampStayParams,
  parseStayParams,
  STAY_PARAM_KEYS,
  stayParamsQuery,
  type StayParams,
  type StayRules,
} from '../../app/stayParams';

/** `search` with the stay's keys replaced by `stay`, other keys kept after them. */
export function withStay(search: string, stay: StayParams): string {
  const own = new Set<string>(STAY_PARAM_KEYS);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(stayParamsQuery(stay))) {
    query.append(key, String(value));
  }
  for (const [key, value] of new URLSearchParams(search)) {
    if (!own.has(key)) query.append(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

/**
 * The place page's stay, in its own query string so it can be shared and survives a reload.
 * A stay in the address is kept to the provider's `rules` (and the address rewritten in
 * place when it was not). Changes replace the history entry (Back still leaves the page in
 * one step) and keep the entry's state (where the page was opened from).
 */
export function usePlaceStay(rules: StayRules) {
  const location = useLocation();
  const navigate = useNavigate();
  const { minDate, maxNights } = rules;
  const stay = useMemo(
    () => clampStayParams(parseStayParams(location.search), { minDate, maxNights }),
    [location.search, minDate, maxNights]
  );
  const latestRules = useRef(rules);
  latestRules.current = rules;

  const latest = useRef(location);
  latest.current = location;
  // The last write and the address it was made from, so two changes before the next render
  // build on each other.
  const pending = useRef<{ from: string; to: string } | null>(null);

  const setStay = useCallback(
    (patch: Partial<StayParams>) => {
      const { pathname, search, state } = latest.current;
      const base = pending.current?.from === search ? pending.current.to : search;
      const next = clampStayParams({ ...parseStayParams(base), ...patch }, latestRules.current);
      const target = withStay(base, next);
      if (target === base) return;
      pending.current = { from: search, to: target };
      navigate({ pathname, search: target }, { replace: true, state });
    },
    [navigate]
  );

  // An address whose stay broke the rules is rewritten to the stay the page uses.
  const canonical = withStay(location.search, stay);
  useEffect(() => {
    if (canonical === location.search) return;
    navigate(
      { pathname: location.pathname, search: canonical },
      { replace: true, state: location.state }
    );
  }, [canonical, location.search, location.pathname, location.state, navigate]);

  return { stay, setStay };
}
