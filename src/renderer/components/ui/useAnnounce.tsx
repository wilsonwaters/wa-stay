import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Portal } from './Portal';

export type Politeness = 'polite' | 'assertive';
export type Announce = (message: string, politeness?: Politeness) => void;

const AnnouncerContext = createContext<Announce | null>(null);

/**
 * Owns two visually hidden live regions (polite and assertive), portalled to `document.body`
 * so they keep announcing while a modal makes `#root` inert.
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const flip = useRef(false);

  const announce = useCallback<Announce>((message, politeness = 'polite') => {
    // A trailing no-break space on every other call makes a repeated message a real change,
    // so screen readers announce it again.
    flip.current = !flip.current;
    const text = flip.current ? message : `${message}\u00A0`;
    if (politeness === 'assertive') setAssertive(text);
    else setPolite(text);
  }, []);

  return (
    <AnnouncerContext.Provider value={announce}>
      {children}
      <Portal>
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {polite}
        </div>
        <div className="sr-only" aria-live="assertive" aria-atomic="true">
          {assertive}
        </div>
      </Portal>
    </AnnouncerContext.Provider>
  );
}

/** `const announce = useAnnounce(); announce('3 results')`. Polite unless asked otherwise. */
export function useAnnounce(): Announce {
  const announce = useContext(AnnouncerContext);
  if (!announce) throw new Error('useAnnounce must be used inside <AnnouncerProvider>');
  return announce;
}
