import type { Ref, RefCallback, RefObject } from 'react';

/** Combines several refs (callback or object) into one callback ref. */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(value);
      else if (ref) (ref as RefObject<T | null>).current = value;
    }
  };
}

/** Calls both handlers: the element's own first, then ours unless it called preventDefault. */
export function composeHandlers<E extends { defaultPrevented?: boolean }>(
  theirs: ((event: E) => void) | undefined,
  ours: (event: E) => void
): (event: E) => void {
  return (event) => {
    theirs?.(event);
    if (!event.defaultPrevented) ours(event);
  };
}
