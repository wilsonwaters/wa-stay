import { FormProvider, useForm } from 'react-hook-form';
import { screen, within } from '@testing-library/react';
import type { UnitSummary } from '../../../../shared/types/catalog.types';
import { PARKSTAY_MANIFEST } from '@tests/utils/renderer/createMockApi';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { emptyWatchForm } from './watchFormMapping';
import type { WatchFormValues } from './watchFormSchema';
import { WatchStayFields } from './WatchStayFields';

function Harness({ units }: { units?: UnitSummary[] }) {
  const form = useForm<WatchFormValues>({ defaultValues: emptyWatchForm(PARKSTAY_MANIFEST) });
  return (
    <FormProvider {...form}>
      <WatchStayFields
        manifest={PARKSTAY_MANIFEST}
        today="2099-01-01"
        units={units}
        noun={{ one: 'site', many: 'sites' }}
      />
    </FormProvider>
  );
}

const site = (n: number): UnitSummary => ({
  unitId: String(n),
  unitName: `Site ${n}`,
  unitKind: 'campsite',
});

describe('WatchStayFields: which places offer stay types', () => {
  it('offers none while the place’s units are not known', () => {
    renderWithProviders(<Harness />);
    expect(screen.queryByRole('group', { name: 'Stay type' })).toBeNull();
  });

  it('offers none at a place whose units have no kind, or only one kind', () => {
    const { unmount } = renderWithProviders(
      <Harness
        units={[
          { unitId: '1', unitName: 'Room 1' },
          { unitId: '2', unitName: 'Room 2' },
        ]}
      />
    );
    expect(screen.queryByRole('group', { name: 'Stay type' })).toBeNull();
    unmount();
    renderWithProviders(<Harness units={[site(1), site(2)]} />);
    expect(screen.queryByRole('group', { name: 'Stay type' })).toBeNull();
  });

  it('offers "Camping" alone at a place with sites and units of no kind, never "Other"', () => {
    renderWithProviders(<Harness units={[site(1), { unitId: 'x', unitName: 'Shelter' }]} />);
    const group = screen.getByRole('group', { name: 'Stay type' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((chip) => chip.textContent)
    ).toEqual(['Camping']);
  });

  it('offers "Camping" and "Dorms" at a campground with a hut, above the units', () => {
    renderWithProviders(
      <Harness units={[site(1), { unitId: 'h', unitName: 'Hut', unitKind: 'dorm' }]} />
    );
    const group = screen.getByRole('group', { name: 'Stay type' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((chip) => chip.textContent)
    ).toEqual(['Camping', 'Dorms']);
    const choose = screen.getByRole('button', { name: 'Choose sites' });
    expect(group.compareDocumentPosition(choose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
