/**
 * Renders the whole WA Stay app (providers, shell, routes) at `route`, the way main.tsx does,
 * with a mock `window.api` and a fresh query client:
 *
 *   const { user, mock } = renderWithApp({ route: '/watches/12' });
 *   await user.click(screen.getByRole('link', { name: 'Explore' }));
 *
 * `api` takes stubs for createMockApi, a MockApi you built, or `null` for no `window.api` at
 * all (the renderer opened in a plain browser). The app mounts in a `#root` container, as in
 * index.html, because modals make `#root` inert and the tray watches for that.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../../src/renderer/app/App';
import { createQueryClient } from '../../../src/renderer/app/queryClient';
import { createMockApi, type ApiStubs, type MockApi } from './createMockApi';

export interface RenderWithAppOptions {
  /** The in-app path to start on, with any query string: `/watches/create?location=1`. */
  route?: string;
  api?: ApiStubs | MockApi | null;
  /** userEvent.setup options; under fake timers, `{ advanceTimers: jest.advanceTimersByTime }`. */
  user?: Parameters<typeof userEvent.setup>[0];
}

function isMockApi(api: ApiStubs | MockApi): api is MockApi {
  return 'emit' in api && 'api' in api;
}

function installApi(api: Window['api'] | undefined) {
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
  if (api === undefined) delete (window as { api?: unknown }).api;
}

export function renderWithApp({
  route = '/',
  api = {},
  user: userOptions,
}: RenderWithAppOptions = {}) {
  const mock = api === null ? null : isMockApi(api) ? api : createMockApi(api);
  installApi(mock?.api);
  window.location.hash = `#${route}`;

  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);

  const queryClient = createQueryClient();
  const user = userEvent.setup(userOptions);
  const result = render(<App queryClient={queryClient} />, { container: root });
  return { ...result, user, queryClient, mock };
}

/** The current in-app path and query, as HashRouter sees it. */
export function currentRoute(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}

/**
 * The banner landmarks, as a browser computes them. jsdom's role lookup also counts a `<header>`
 * inside `<main>` (every PageHeader), which browsers do not treat as a banner.
 */
export function getBanners(): HTMLElement[] {
  return screen
    .getAllByRole('banner')
    .filter((el) => !el.parentElement?.closest('article, aside, main, nav, section'));
}
