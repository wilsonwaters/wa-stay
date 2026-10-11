import { FormProvider, useForm } from 'react-hook-form';
import { screen } from '@testing-library/react';
import type { UnitSummary } from '../../../../../shared/types/catalog.types';
import type { ProviderManifest } from '../../../../../shared/types/provider.types';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST } from '@tests/utils/renderer/createMockApi';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { emptyWatchForm } from '../../form/watchFormMapping';
import type { WatchFormValues } from '../../form/watchFormSchema';
import { StayStep } from './StayStep';

function Harness({ manifest, units }: { manifest: ProviderManifest; units?: UnitSummary[] }) {
  const form = useForm<WatchFormValues>({ defaultValues: emptyWatchForm(manifest) });
  return (
    <FormProvider {...form}>
      <StayStep
        manifest={manifest}
        today="2099-01-01"
        units={units}
        noun={{ one: 'site', many: 'sites' }}
      />
    </FormProvider>
  );
}

describe('StayStep', () => {
  it('asks for the provider’s own watch fields, starting from their defaults', () => {
    renderWithProviders(<Harness manifest={PARKSTAY_MANIFEST} />);
    expect(screen.getByRole('combobox', { name: 'Camping with' })).toHaveValue('all');
    expect(screen.queryByRole('textbox', { name: /Postcode/ })).toBeNull();
  });

  it('has no provider fields for a provider that declares none', () => {
    renderWithProviders(<Harness manifest={FAKE_MANIFEST} />);
    expect(screen.queryByRole('combobox', { name: 'Camping with' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Dates/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Guests 2 adults/ })).toBeInTheDocument();
  });

  it('keeps the max price, saying it applies only when the provider shows prices', () => {
    renderWithProviders(<Harness manifest={FAKE_MANIFEST} />);
    expect(
      screen.getByRole('textbox', { name: /Max price per night/ })
    ).toHaveAccessibleDescription(
      'In dollars. Applied only when Fake Stay shows a price for every night.'
    );
  });

  it('hides the unit choice when the location has no units, and offers it when it has some', () => {
    const { unmount } = renderWithProviders(<Harness manifest={PARKSTAY_MANIFEST} units={[]} />);
    expect(screen.queryByText('Preferred sites')).toBeNull();
    unmount();
    renderWithProviders(
      <Harness
        manifest={PARKSTAY_MANIFEST}
        units={[{ unitId: '1', unitName: 'Site 1', unitType: 'Powered' }]}
      />
    );
    expect(screen.getByText('Preferred sites')).toBeInTheDocument();
    expect(screen.getByText(/Any site\./)).toBeInTheDocument();
  });
});
