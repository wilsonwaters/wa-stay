import { FormProvider, useForm } from 'react-hook-form';
import { screen, within } from '@testing-library/react';
import { PARKSTAY_MANIFEST } from '@tests/utils/renderer/createMockApi';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { emptyWatchForm } from '../../form/watchFormMapping';
import type { WatchFormValues } from '../../form/watchFormSchema';
import { unitNounFor } from '../../shared/watchState';
import { ReviewStep, type FlowStepId } from './ReviewStep';

const PHOTO = 'https://example.org/osprey.jpg';

function Harness({
  values,
  onChangeStep,
}: {
  values: Partial<WatchFormValues>;
  onChangeStep: (step: FlowStepId) => void;
}) {
  const form = useForm<WatchFormValues>({
    defaultValues: { ...emptyWatchForm(PARKSTAY_MANIFEST), ...values },
  });
  return (
    <FormProvider {...form}>
      <ReviewStep
        manifest={PARKSTAY_MANIFEST}
        today="2099-01-01"
        noun={unitNounFor(PARKSTAY_MANIFEST)}
        place={{ kind: 'campground', imageUrls: [PHOTO] }}
        onChangeStep={onChangeStep}
      />
    </FormProvider>
  );
}

const VALUES: Partial<WatchFormValues> = {
  location: { externalId: '20', name: 'Osprey Bay', areaName: 'Cape Range National Park' },
  arrival: '2099-12-11',
  departure: '2099-12-13',
  adults: 2,
  maxPrice: '42.5',
  checkIntervalMinutes: 5,
};

describe('ReviewStep', () => {
  it('groups the choices as Where, When, Who and Alerts, each with one Change', async () => {
    const onChangeStep = jest.fn();
    const { user } = renderWithProviders(<Harness values={VALUES} onChangeStep={onChangeStep} />);
    const sections = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(sections).toEqual(['Where', 'When', 'Who', 'Alerts']);
    for (const [section, change, step] of [
      ['Where', 'Change location', 'location'],
      ['When', 'Change dates', 'stay'],
      ['Who', 'Change guests', 'stay'],
      ['Alerts', 'Change alerts', 'alerts'],
    ] as const) {
      const region = screen.getByRole('region', { name: section });
      expect(within(region).getAllByRole('button')).toHaveLength(1);
      await user.click(within(region).getByRole('button', { name: change }));
      expect(onChangeStep).toHaveBeenLastCalledWith(step);
    }
  });

  it('shows the place with its photo, the price in the provider’s currency and an honest interval', () => {
    renderWithProviders(<Harness values={VALUES} onChangeStep={jest.fn()} />);
    const where = screen.getByRole('region', { name: 'Where' });
    expect(within(where).getByRole('img', { name: 'Osprey Bay' })).toHaveAttribute('src', PHOTO);
    expect(within(where).getByText('Cape Range National Park')).toBeInTheDocument();
    const who = screen.getByRole('region', { name: 'Who' });
    expect(within(who).getByText('$42.50')).toBeInTheDocument();
    expect(within(who).getByText('2 adults')).toBeInTheDocument();
    const alerts = screen.getByRole('region', { name: 'Alerts' });
    expect(within(alerts).getByText('Every 5 minutes (checks run every 15)')).toBeInTheDocument();
  });
});
