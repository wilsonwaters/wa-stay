import { act, screen, waitFor } from '@testing-library/react';
import { createMockApi } from '@tests/utils/renderer/createMockApi';
import { currentRoute, renderWithApp } from '@tests/utils/renderer/renderWithApp';

describe('app:navigate (a desktop notification was clicked)', () => {
  it('opens the page main asks for', async () => {
    const mock = createMockApi({
      watches: {
        get: jest
          .fn()
          .mockResolvedValue({ success: false, error: 'Watch not found', code: 'NOT_FOUND' }),
      },
    });
    renderWithApp({ api: mock });
    await screen.findByRole('heading', { level: 1, name: 'Explore places to stay' });

    mock.emit('app:navigate', { path: '/watches/12' });

    await waitFor(() => expect(currentRoute()).toBe('/watches/12'));
    expect(mock.api.watches.get).toHaveBeenCalledWith(12);
  });

  it.each(['https://evil.example', '/places/parkstay/12', '/watches/12/edit', '#/settings'])(
    'ignores %s, which is not an allowed in-app page',
    async (path) => {
      const mock = createMockApi();
      // A page with a stable address (/settings itself redirects to its first section)
      renderWithApp({ route: '/settings/accounts', api: mock });
      await screen.findByRole('heading', { level: 1, name: 'Settings' });

      mock.emit('app:navigate', { path });

      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
      expect(currentRoute()).toBe('/settings/accounts');
    }
  );
});
