/**
 * Route focus when a page replaces the heading it showed first: a page that renders its `h1`,
 * then a spinner while it loads, then the `h1` again (the legacy Settings page can do this).
 * The focus lost with the first heading must follow the second; the Electron smoke tests (Q1)
 * caught it left on the body.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { AnnouncerProvider } from '../components/ui';
import { useRouteFocus } from './useRouteFocus';

interface Reload {
  /** Resolve to show the spinner. */
  start: Promise<void>;
  /** Resolve to show the heading again. */
  finish: Promise<void>;
}

function ReloadingPage({ reload }: { reload: Reload }) {
  const [phase, setPhase] = useState<'first' | 'loading' | 'loaded'>('first');
  useEffect(() => {
    void reload.start.then(() => setPhase('loading'));
    void reload.finish.then(() => setPhase('loaded'));
  }, [reload]);
  if (phase === 'loading') return <p>Loading…</p>;
  return <h1>{phase === 'first' ? 'Settings' : 'Settings again'}</h1>;
}

function Shell({ reload, extra }: { reload: Reload; extra?: ReactNode }) {
  const mainRef = useRef<HTMLElement>(null);
  useRouteFocus(mainRef);
  return (
    <>
      <Link to="/reloading">Go</Link>
      {extra}
      <main ref={mainRef} tabIndex={-1}>
        <Routes>
          <Route path="/" element={<h1>Home</h1>} />
          <Route path="/reloading" element={<ReloadingPage reload={reload} />} />
        </Routes>
      </main>
    </>
  );
}

function setup(extra?: ReactNode) {
  const control = { start: () => {}, finish: () => {} };
  const reload: Reload = {
    start: new Promise((resolve) => (control.start = resolve)),
    finish: new Promise((resolve) => (control.finish = resolve)),
  };
  render(
    <AnnouncerProvider>
      <MemoryRouter>
        <Shell reload={reload} extra={extra} />
      </MemoryRouter>
    </AnnouncerProvider>
  );
  return control;
}

describe('useRouteFocus when a page replaces its heading', () => {
  it('moves the focus lost with the first h1 to the new one', async () => {
    const control = setup();

    act(() => screen.getByRole('link', { name: 'Go' }).click());
    const first = await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await waitFor(() => expect(first).toHaveFocus());

    await act(async () => control.start());
    expect(document.body).toHaveFocus();
    await act(async () => control.finish());

    const again = screen.getByRole('heading', { level: 1, name: 'Settings again' });
    await waitFor(() => expect(again).toHaveFocus());
  });

  it('leaves focus alone once the person has moved it to a control', async () => {
    const control = setup(<button type="button">Elsewhere</button>);

    act(() => screen.getByRole('link', { name: 'Go' }).click());
    const first = await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await waitFor(() => expect(first).toHaveFocus());
    await act(async () => control.start());
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    act(() => elsewhere.focus());
    await act(async () => control.finish());

    await screen.findByRole('heading', { level: 1, name: 'Settings again' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(elsewhere).toHaveFocus();
  });
});

/** A page with an `h1` and a button it may focus itself when it mounts (a deep link's target). */
function FocusingPage({ title, focusOnMount }: { title: string; focusOnMount?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);
  return (
    <>
      <h1>{title}</h1>
      <h2 tabIndex={-1}>Section</h2>
      <button ref={ref} type="button">
        Target
      </button>
    </>
  );
}

function SettingsShell() {
  const mainRef = useRef<HTMLElement>(null);
  useRouteFocus(mainRef);
  return (
    <>
      <Link to="/settings/accounts">Accounts</Link>
      <Link to="/settings/notifications">Notifications</Link>
      <Link to="/settings/accounts?provider=parkstay">Deep link</Link>
      <main ref={mainRef} tabIndex={-1}>
        <Routes>
          <Route path="/" element={<h1>Home</h1>} />
          <Route
            path="/settings/:section"
            element={<FocusingPage title="Settings" focusOnMount={false} />}
          />
        </Routes>
      </main>
    </>
  );
}

function DeepLinkShell() {
  const mainRef = useRef<HTMLElement>(null);
  useRouteFocus(mainRef);
  return (
    <>
      <Link to="/settings/accounts?provider=parkstay">Deep link</Link>
      <main ref={mainRef} tabIndex={-1}>
        <Routes>
          <Route path="/" element={<h1>Home</h1>} />
          <Route
            path="/settings/:section"
            element={<FocusingPage title="Settings" focusOnMount />}
          />
        </Routes>
      </main>
    </>
  );
}

function renderAt(shell: ReactNode) {
  render(
    <AnnouncerProvider>
      <MemoryRouter>{shell}</MemoryRouter>
    </AnnouncerProvider>
  );
}

describe('useRouteFocus and Settings', () => {
  it('settings sections are one page for route focus: changing section leaves focus alone', async () => {
    renderAt(<SettingsShell />);

    act(() => screen.getByRole('link', { name: 'Accounts' }).click());
    const heading = await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await waitFor(() => expect(heading).toHaveFocus());

    // The section moves focus to its own heading; the shell must not take it back
    const section = screen.getByRole('heading', { level: 2, name: 'Section' });
    act(() => screen.getByRole('link', { name: 'Notifications' }).click());
    act(() => section.focus());
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(section).toHaveFocus();
  });

  it('a page that placed focus inside main itself keeps it, and its title is still announced', async () => {
    renderAt(<DeepLinkShell />);

    act(() => screen.getByRole('link', { name: 'Deep link' }).click());
    const target = await screen.findByRole('button', { name: 'Target' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(target).toHaveFocus();
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain('Settings');
  });
});
