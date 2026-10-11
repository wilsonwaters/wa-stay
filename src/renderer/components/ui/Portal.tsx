import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders children at the end of `document.body`, outside `#root`, so `inert` never reaches them.
 * Overlays use it, and so must every floating surface that has to stay usable while a modal is
 * open: the toast viewport today, the tray (D3) later.
 */
export function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

export default Portal;
