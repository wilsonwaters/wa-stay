/**
 * Renders one component inside the app's providers (router, React Query, toasts with their
 * viewport, the announcer and the provider manifests), with a mock `window.api`, without the
 * shell or the route table: for testing a page or a shared block on its own.
 *
 *   const { user, mock } = renderWithProviders(<WatchesPage />, {
 *     route: '/watches?status=active',
 *     api: { watches: { list: jest.fn().mockResolvedValue(ok([makeWatch()])) } },
 *   });
 */
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProviders } from '../../../src/renderer/app/AppProviders';
import { createQueryClient } from '../../../src/renderer/app/queryClient';
import { ToastViewport } from '../../../src/renderer/components/ui';
import { createMockApi, type ApiStubs, type MockApi } from './createMockApi';

export interface RenderWithProvidersOptions {
  /** The in-app path (HashRouter), with any query string. */
  route?: string;
  api?: ApiStubs | MockApi;
  /** userEvent options, e.g. `{ advanceTimers: jest.advanceTimersByTime }` under fake timers. */
  userOptions?: Parameters<typeof userEvent.setup>[0];
}

function isMockApi(api: ApiStubs | MockApi): api is MockApi {
  return 'emit' in api && 'api' in api;
}

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', api = {}, userOptions }: RenderWithProvidersOptions = {}
) {
  const mock = isMockApi(api) ? api : createMockApi(api);
  Object.defineProperty(window, 'api', { value: mock.api, configurable: true, writable: true });
  window.location.hash = `#${route}`;
  const queryClient = createQueryClient();
  const user = userEvent.setup(userOptions);
  const result = render(
    <AppProviders queryClient={queryClient}>
      {ui}
      <ToastViewport />
    </AppProviders>
  );
  return { ...result, user, mock, queryClient };
}

/** What the app's polite announcer (`useAnnounce`) last said, without its repeat marker. */
export function politeAnnouncement(): string {
  const region = document.querySelector('[aria-live="polite"][aria-atomic="true"]');
  return (region?.textContent ?? '').replace(/\u00a0/g, '').trim();
}
