import { useCallback, useId, useState } from 'react';

export interface UseDisclosureOptions {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Open/closed state plus the ARIA wiring for a show/hide pattern: spread `buttonProps` on
 * the button and `panelProps` on the region it controls.
 */
export function useDisclosure({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
}: UseDisclosureOptions = {}) {
  const [inner, setInner] = useState(defaultOpen);
  const open = controlled ?? inner;
  const buttonId = useId();
  const panelId = useId();

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlled === undefined) setInner(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange]
  );
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);

  return {
    open,
    setOpen,
    toggle,
    buttonProps: {
      id: buttonId,
      type: 'button' as const,
      'aria-expanded': open,
      'aria-controls': panelId,
      onClick: toggle,
    },
    panelProps: {
      id: panelId,
      hidden: !open,
    },
  };
}
