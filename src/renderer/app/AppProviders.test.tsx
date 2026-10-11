import { render, screen, waitFor } from '@testing-library/react';
import { createMockApi, fail, ok } from '@tests/utils/renderer/createMockApi';
import { ProviderBadge, ToastViewport } from '../components/ui';
import { AppProviders } from './AppProviders';
import { createQueryClient } from './queryClient';

function renderBadge() {
  return render(
    <AppProviders queryClient={createQueryClient()}>
      <ProviderBadge providerId="parkstay" />
      <ToastViewport />
    </AppProviders>
  );
}

describe('AppProviders', () => {
  it('fills the provider manifests, so a ProviderBadge needs only an id', async () => {
    const mock = createMockApi();
    window.api = mock.api;
    renderBadge();
    expect(await screen.findByRole('img', { name: 'ParkStay WA' })).toHaveTextContent('ParkStay');
    expect(mock.api.providers.list).toHaveBeenCalledTimes(1);
  });

  it('falls back to the unknown badge when there are no providers', async () => {
    window.api = createMockApi({ providers: { list: jest.fn().mockResolvedValue(ok([])) } }).api;
    renderBadge();
    await waitFor(() => expect(window.api.providers.list).toHaveBeenCalled());
    expect(await screen.findByRole('img', { name: 'Unknown provider' })).toHaveTextContent(
      'parkstay'
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falls back to the unknown badge and shows one error toast when the list fails', async () => {
    window.api = createMockApi({
      providers: { list: jest.fn().mockResolvedValue(fail('Registry offline', 'NOT_FOUND')) },
    }).api;
    renderBadge();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Provider details couldn't be loaded. Registry offline"
    );
    expect(screen.getByRole('img', { name: 'Unknown provider' })).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});
