import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  parseExploreParams,
  replaceExploreParams,
  type ExploreParams,
  type KnownValues,
  type MapCamera,
} from './exploreParams';

/** Camera changes are written this long after the map stops moving. */
export const CAMERA_WRITE_DELAY_MS = 500;

export type ExploreParamsPatch =
  Partial<ExploreParams> | ((current: ExploreParams) => Partial<ExploreParams>);

export interface UseExploreParams {
  params: ExploreParams;
  /** Changes some values. Pushes a history entry unless `replace` is set. */
  update(patch: ExploreParamsPatch, options?: { replace?: boolean }): void;
  /**
   * Records the camera of a map the person moved: debounced 500 ms, and replaces rather than
   * pushes. An `update` that sets `map` itself cancels a camera still waiting to be written.
   */
  setCamera(camera: MapCamera): void;
}

/**
 * Explore's state, read from and written to the URL. Invalid values are dropped and the URL
 * is rewritten with `replace`. Keys Explore does not own are kept as they are.
 *
 * Pass `known` lists memoised: a new list (or set) re-checks the URL against it.
 */
export function useExploreParams(known: KnownValues = {}): UseExploreParams {
  const location = useLocation();
  const navigate = useNavigate();
  const { providers, regions, amenities, keys } = known;

  const { params, canonical } = useMemo(
    () => parseExploreParams(location.search, { providers, regions, amenities, keys }),
    [location.search, providers, regions, amenities, keys]
  );

  // The latest state, for callbacks that outlive a render (map events, debounced writes).
  const latest = useRef({ params, search: location.search, pathname: location.pathname });
  latest.current = { params, search: location.search, pathname: location.pathname };
  // What was last written (`to`, `params`) and from which rendered address (`from`). Until the
  // router renders the write, the address is `to`, not `location.search`: two updates in one
  // tick build on each other, and an update that undoes a write not yet rendered (the camera's
  // timer, then a click) is still written. Once the router renders another address, the write
  // is history: after Back to `from`, it must not come back.
  const pending = useRef<{ from: string; to: string; params: ExploreParams } | null>(null);
  if (pending.current && pending.current.from !== location.search) pending.current = null;

  const unrendered = useCallback(() => {
    const { search } = latest.current;
    return pending.current && pending.current.from === search ? pending.current : null;
  }, []);

  const current = useCallback(
    (): ExploreParams => unrendered()?.params ?? latest.current.params,
    [unrendered]
  );

  const write = useCallback(
    (next: ExploreParams, replace: boolean) => {
      const { search, pathname } = latest.current;
      const address = unrendered()?.to ?? search;
      const target = replaceExploreParams(address, next);
      if (target === address) return;
      pending.current = { from: search, to: target, params: next };
      navigate({ pathname, search: target }, { replace });
    },
    [navigate, unrendered]
  );

  const cameraTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const update = useCallback(
    (patch: ExploreParamsPatch, options: { replace?: boolean } = {}) => {
      const base = current();
      const changes = typeof patch === 'function' ? patch(base) : patch;
      // A new search clears the camera (or a place sets one): an older one must not land later.
      if ('map' in changes) clearTimeout(cameraTimer.current);
      write({ ...base, ...changes }, options.replace ?? false);
    },
    [current, write]
  );

  const setCamera = useCallback(
    (camera: MapCamera) => {
      clearTimeout(cameraTimer.current);
      cameraTimer.current = setTimeout(() => {
        write({ ...current(), map: camera }, true);
      }, CAMERA_WRITE_DELAY_MS);
    },
    [current, write]
  );
  useEffect(() => () => clearTimeout(cameraTimer.current), []);

  // Rewrite an address with invalid values in place, without a history entry.
  useEffect(() => {
    if (canonical !== location.search) {
      navigate({ pathname: location.pathname, search: canonical }, { replace: true });
    }
  }, [canonical, location.search, location.pathname, navigate]);

  return { params, update, setCamera };
}
