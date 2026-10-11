import { useEffect, useState, type ReactNode } from 'react';
import { Portal, ToastViewport } from '../components/ui';
import { AccessStatusChips } from '../features/notifications/AccessStatusChip';
import { UpdateCard } from '../features/notifications/UpdateCard';

/**
 * True while a modal is open. The overlay stack marks `#root` inert for exactly that long
 * (components/ui/OverlayStack.tsx), whichever stack instance opened the modal.
 */
function useModalOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;
    const sync = () => setOpen(root.hasAttribute('inert'));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['inert'] });
    return () => observer.disconnect();
  }, []);
  return open;
}

export interface TrayProps {
  /**
   * Another floating layer is open where the tray sits (the notification list): set the
   * update card and access chips aside, as for a modal, so the two never overlap.
   */
  setAside?: boolean;
}

/**
 * The one bottom-right stack for floating messages, top to bottom: toasts, the update card,
 * then one access-status chip per provider whose queue is in use. They stack in one column and
 * never overlap. Portalled outside `#root`, so a modal's `inert` never silences it. The column
 * never takes clicks itself (`pointer-events-none`); only the cards in it do.
 *
 * It sits at `z-tray`, under the modal scrim and popovers. While a modal or the notification
 * list is open it rises to `z-toast` so toasts stay readable and clickable above it, and the
 * other slots are hidden (keeping their space, so toasts do not move) until it closes: one
 * floating layer at a time (design-language.md, Elevation).
 */
export function Tray({ setAside = false }: TrayProps) {
  const modalOpen = useModalOpen();
  const aside = modalOpen || setAside;
  return (
    <Portal>
      <div
        data-testid="tray"
        data-modal-open={modalOpen || undefined}
        data-set-aside={aside || undefined}
        className={`pointer-events-none fixed bottom-4 right-4 flex w-95 max-w-[calc(100vw-2rem)] flex-col items-stretch gap-2 ${
          aside ? 'z-toast' : 'z-tray'
        }`}
      >
        <ToastViewport />
        <TraySlot hidden={aside}>
          <UpdateCard />
        </TraySlot>
        <TraySlot hidden={aside}>
          <AccessStatusChips />
        </TraySlot>
      </div>
    </Portal>
  );
}

/**
 * A slot adds no box of its own (`display: contents`), so a card that renders nothing leaves
 * no gap in the column. Hidden slots are `inert` and invisible.
 */
function TraySlot({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  return (
    <div inert={hidden} className={`contents ${hidden ? '*:invisible' : ''}`}>
      {children}
    </div>
  );
}

export default Tray;
