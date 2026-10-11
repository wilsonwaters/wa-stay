import { render, screen } from '@testing-library/react';
import type { StayFieldDescriptor } from '../../../shared/types/provider.types';
import { ProviderStayFields } from './ProviderStayFields';

const FIELDS: StayFieldDescriptor[] = [
  {
    key: 'gear',
    label: 'Camping with',
    type: 'select',
    options: [{ value: 'tent', label: 'Tent' }],
    appliesTo: ['watch'],
  },
  { key: 'vehicles', label: 'Vehicles', type: 'number', min: 0, max: 5, appliesTo: ['watch'] },
  { key: 'postcode', label: 'Postcode', type: 'text', appliesTo: ['watch'] },
  { key: 'powered', label: 'Powered site', type: 'boolean', appliesTo: ['watch'] },
];

describe('ProviderStayFields', () => {
  it('draws each declared field with the control for its type', () => {
    render(
      <ProviderStayFields
        fields={FIELDS}
        values={{ gear: 'tent', vehicles: 2 }}
        onChange={jest.fn()}
      />
    );
    expect(screen.getByRole('combobox', { name: 'Camping with' })).toHaveValue('tent');
    expect(screen.getByRole('group', { name: 'Vehicles' })).toHaveTextContent('2');
    expect(screen.getByRole('textbox', { name: /Postcode/ })).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'Powered site' })).not.toBeChecked();
  });

  it('shows an error on every field type, marked invalid and read with the control', () => {
    render(
      <ProviderStayFields
        fields={FIELDS}
        values={{}}
        onChange={jest.fn()}
        errors={{
          gear: 'Pick one',
          vehicles: 'Vehicles must be at most 5',
          postcode: 'Postcode is not in the expected format',
          powered: 'Powered site must be yes or no',
        }}
      />
    );
    const controls = [
      [screen.getByRole('combobox', { name: 'Camping with' }), 'Pick one'],
      [screen.getByRole('group', { name: 'Vehicles' }), 'Vehicles must be at most 5'],
      [screen.getByRole('textbox', { name: /Postcode/ }), 'Postcode is not in the expected format'],
      [screen.getByRole('checkbox', { name: 'Powered site' }), 'Powered site must be yes or no'],
    ] as const;
    for (const [control, message] of controls) {
      expect(control).toHaveAttribute('aria-invalid', 'true');
      expect(control).toHaveAccessibleDescription(expect.stringContaining(message));
    }
  });
});
