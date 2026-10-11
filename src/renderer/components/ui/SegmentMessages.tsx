import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { VisuallyHidden } from './VisuallyHidden';

export interface SegmentMessagesProps {
  hint?: ReactNode;
  hintId?: string;
  error?: ReactNode;
  errorId?: string;
}

/**
 * The hint and error of a search-pill segment (`appearance="segment"`), rendered so every id
 * in the control's `aria-describedby` exists. The pill has no room for a hint line, so the
 * hint is for screen readers only; the error is shown under the value (icon and words) and read.
 */
export function SegmentMessages({ hint, hintId, error, errorId }: SegmentMessagesProps) {
  return (
    <>
      {hint && <VisuallyHidden id={hintId}>{hint}</VisuallyHidden>}
      {error && (
        <span id={errorId} className="flex items-start gap-1 text-xs font-medium text-danger">
          <CircleAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </span>
      )}
    </>
  );
}

export default SegmentMessages;
