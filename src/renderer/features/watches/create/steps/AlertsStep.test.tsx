import { FormProvider, useForm } from 'react-hook-form';
import { screen, waitFor, within } from '@testing-library/react';
import type { ProviderManifest } from '../../../../../shared/types/provider.types';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST, ok } from '@tests/utils/renderer/createMockApi';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { RAC_AUTO_CART_MANIFEST, RAC_MANIFEST } from '@tests/utils/renderer/manifests';
import { racAccount } from '@tests/fixtures/renderer/settings';
import { emptyWatchForm } from '../../form/watchFormMapping';
import type { WatchFormValues } from '../../form/watchFormSchema';
import { stayNoun } from '../../../../components/stay/stayTypes';
import { AlertsStep } from './AlertsStep';

function Harness({ manifest }: { manifest: ProviderManifest }) {
  const form = useForm<WatchFormValues>({ defaultValues: emptyWatchForm(manifest) });
  return (
    <FormProvider {...form}>
      <AlertsStep manifest={manifest} noun={stayNoun([], undefined, undefined, manifest)} />
    </FormProvider>
  );
}

const accounts = (list: unknown[]) => ({
  accounts: { list: jest.fn().mockResolvedValue(ok(list)) },
});
const toggle = () => screen.queryByRole('checkbox', { name: /automatically when found/ });

describe('AlertsStep', () => {
  it('no auto-hold toggle when holds is false', () => {
    renderWithProviders(<Harness manifest={FAKE_MANIFEST} />, { api: accounts([]) });
    expect(toggle()).toBeNull();
    expect(
      screen.getByRole('checkbox', { name: 'Alert on partial availability' })
    ).toBeInTheDocument();
  });

  it('shows "Hold a site automatically when found" when holds is true', () => {
    renderWithProviders(<Harness manifest={PARKSTAY_MANIFEST} />, { api: accounts([]) });
    expect(
      screen.getByRole('checkbox', { name: 'Hold a site automatically when found' })
    ).not.toBeChecked();
  });

  it('asks for the provider’s hold fields once auto-hold is ticked', async () => {
    const { user } = renderWithProviders(<Harness manifest={PARKSTAY_MANIFEST} />, {
      api: accounts([]),
    });
    expect(screen.queryByRole('textbox', { name: /Postcode/ })).toBeNull();
    await user.click(
      screen.getByRole('checkbox', { name: 'Hold a site automatically when found' })
    );
    expect(screen.getByRole('group', { name: 'Vehicles' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Postcode/ })).toBeInTheDocument();
  });

  it('suggests connecting an optional account in Settings → Accounts, until signed in', async () => {
    const { mock } = renderWithProviders(<Harness manifest={PARKSTAY_MANIFEST} />, {
      api: accounts([{ providerId: 'parkstay', requirement: 'optional', status: 'signed-out' }]),
    });
    const link = await screen.findByRole('link', { name: 'connect ParkStay in Settings' });
    expect(link).toHaveAttribute('href', '#/settings/accounts?provider=parkstay');
    expect(link.closest('p')).toHaveTextContent(
      'Optional: connect ParkStay in Settings so checkout is quicker.'
    );

    (mock.api.accounts.list as jest.Mock).mockResolvedValue(
      ok([{ providerId: 'parkstay', requirement: 'optional', status: 'signed-in' }])
    );
    mock.emit('account:updated', {
      providerId: 'parkstay',
      requirement: 'optional',
      status: 'signed-in',
    });
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /connect ParkStay/i })).toBeNull()
    );
  });

  it('RAC with auto-cart off: no automatic hold, and no equipment', () => {
    renderWithProviders(<Harness manifest={RAC_MANIFEST} />, { api: accounts([racAccount()]) });
    expect(toggle()).toBeNull();
    expect(screen.queryByRole('combobox', { name: /Equipment/ })).toBeNull();
  });

  it('RAC with auto-cart on: the automatic hold asks for the equipment, and suggests adding the member number, never connecting (R19)', async () => {
    const { user } = renderWithProviders(<Harness manifest={RAC_AUTO_CART_MANIFEST} />, {
      api: accounts([racAccount()]),
    });
    const hold = toggle();
    expect(hold).not.toBeNull();
    const link = await screen.findByRole('link', {
      name: 'add your RAC member number in Settings',
    });
    expect(link).toHaveAttribute('href', '#/settings/accounts?provider=rac');
    expect(link.closest('p')).toHaveTextContent(
      'Optional: add your RAC member number in Settings.'
    );
    expect(screen.queryByRole('link', { name: /connect RAC/i })).toBeNull();

    expect(screen.queryByRole('combobox', { name: /Equipment/ })).toBeNull();
    await user.click(hold!);
    const equipment = screen.getByRole('combobox', { name: /^Equipment/ });
    expect(within(equipment).getAllByRole('option')).toHaveLength(16);
    expect(equipment).toHaveValue('');
    expect(
      screen.getByRole('textbox', { name: /Equipment length \(metres\)/ })
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Equipment width \(metres\)/ })).toBeInTheDocument();
  });

  it('warns when the provider needs an account to hold', async () => {
    const strict: ProviderManifest = {
      ...PARKSTAY_MANIFEST,
      capabilities: { ...PARKSTAY_MANIFEST.capabilities, account: 'required-for-holds' },
    };
    renderWithProviders(<Harness manifest={strict} />, { api: accounts([]) });
    const notice = (
      await screen.findByText('ParkStay needs you signed in to hold a site.')
    ).closest('[role="status"]') as HTMLElement;
    expect(within(notice).getByRole('link', { name: 'Connect ParkStay' })).toHaveAttribute(
      'href',
      '#/settings/accounts?provider=parkstay'
    );
  });

  it('offers the contract’s intervals the provider allows, every hour by default', () => {
    renderWithProviders(<Harness manifest={PARKSTAY_MANIFEST} />, { api: accounts([]) });
    const select = screen.getByRole('combobox', { name: /Check every/ });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual([
      'Every 15 minutes',
      'Every 30 minutes',
      'Every hour',
      'Every 4 hours',
      'Every 12 hours',
      'Once a day',
    ]);
    expect(select).toHaveValue('60');
    expect(
      screen.getByRole('checkbox', { name: 'Stop watching after the first alert' })
    ).toBeChecked();
  });
});
