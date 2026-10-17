import { FormProvider, useForm } from 'react-hook-form';
import { screen, within } from '@testing-library/react';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { PARKSTAY_MANIFEST, RAC_MANIFEST } from '@tests/utils/renderer/manifests';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { emptyWatchForm } from './watchFormMapping';
import type { WatchFormValues } from './watchFormSchema';
import { WatchAlertFields } from './WatchAlertFields';

function Harness({ manifest, keep }: { manifest: ProviderManifest; keep?: number }) {
  const form = useForm<WatchFormValues>({ defaultValues: emptyWatchForm(manifest) });
  return (
    <FormProvider {...form}>
      <WatchAlertFields
        manifest={manifest}
        noun={{ one: 'site', many: 'sites' }}
        keepInterval={keep}
      />
    </FormProvider>
  );
}

const offered = () =>
  within(screen.getByRole('combobox', { name: /Check every/ }))
    .getAllByRole('option')
    .map((option) => [Number((option as HTMLOptionElement).value), option.textContent]);

describe('WatchAlertFields: how often a watch checks', () => {
  it('offers RAC no interval under 15 minutes (its terms, rule 3)', () => {
    renderWithProviders(<Harness manifest={RAC_MANIFEST} />);
    const options = offered();
    expect(options[0]).toEqual([15, 'Every 15 minutes']);
    expect(options.every(([minutes]) => (minutes as number) >= 15)).toBe(true);
    expect(screen.queryByRole('checkbox', { name: /Hold .* automatically/ })).toBeNull();
  });

  it('says an old 5-minute watch runs every 15 at RAC, as at ParkStay', () => {
    for (const manifest of [RAC_MANIFEST, PARKSTAY_MANIFEST]) {
      const { unmount } = renderWithProviders(<Harness manifest={manifest} keep={5} />);
      expect(offered()[0]).toEqual([5, 'Every 5 minutes (checks run every 15)']);
      unmount();
    }
  });
});
