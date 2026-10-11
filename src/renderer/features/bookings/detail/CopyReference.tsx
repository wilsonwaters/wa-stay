import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, useAnnounce } from '../../../components/ui';

export interface CopyReferenceProps {
  reference: string;
}

type Outcome = 'idle' | 'copied' | 'manual';

/** Selects the reference's text, so Ctrl+C copies it when the clipboard can't be written. */
function selectText(element: HTMLElement | null) {
  const selection = window.getSelection();
  if (!element || !selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * The booking reference and a "Copy reference {ref}" button. Copying is announced politely
 * ("Reference copied"); without a clipboard, the reference is selected instead and the person
 * is told to press Ctrl+C.
 */
export function CopyReference({ reference }: CopyReferenceProps) {
  const announce = useAnnounce();
  const textRef = useRef<HTMLSpanElement>(null);
  const [outcome, setOutcome] = useState<Outcome>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    clearTimeout(timer.current);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('No clipboard');
      await navigator.clipboard.writeText(reference);
      setOutcome('copied');
      announce('Reference copied');
      timer.current = setTimeout(() => setOutcome('idle'), 3000);
    } catch {
      selectText(textRef.current);
      setOutcome('manual');
      announce('Press Ctrl+C to copy');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span ref={textRef} className="text-base font-semibold tabular-nums tracking-wide text-fg">
        {reference}
      </span>
      <Button
        variant="ghost"
        size="sm"
        leadingIcon={<Copy size={16} />}
        aria-label={`Copy reference ${reference}`}
        onClick={() => void copy()}
      >
        Copy
      </Button>
      {/* Already announced; shown for sighted people. */}
      {outcome === 'copied' && (
        <span aria-hidden="true" className="inline-flex items-center gap-1 text-sm text-fg-muted">
          <Check size={16} /> Copied
        </span>
      )}
      {outcome === 'manual' && (
        <span aria-hidden="true" className="text-sm text-fg-muted">
          Press Ctrl+C to copy
        </span>
      )}
    </div>
  );
}

export default CopyReference;
