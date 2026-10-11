import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Radio, RadioGroup } from './Radio';

describe('RadioGroup and Radio', () => {
  it('groups native radios under the legend, and arrow keys move the checked radio', async () => {
    const onValueChange = jest.fn();
    render(
      <RadioGroup legend="Site type" defaultValue="tent" onValueChange={onValueChange}>
        <Radio value="tent" label="Tent" />
        <Radio value="caravan" label="Caravan" description="Up to 7 m" />
        <Radio value="cabin" label="Cabin" />
      </RadioGroup>
    );
    expect(screen.getByRole('group', { name: 'Site type' })).toBeInTheDocument();
    const tent = screen.getByRole('radio', { name: 'Tent' });
    expect(tent).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Caravan' })).toHaveAccessibleDescription('Up to 7 m');

    tent.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Caravan' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Caravan' })).toHaveFocus();
    expect(onValueChange).toHaveBeenLastCalledWith('caravan');
  });

  it('follows a controlled value', async () => {
    function Controlled() {
      const [value, setValue] = useState('cabin');
      return (
        <>
          <RadioGroup legend="Stay in" value={value} onValueChange={setValue}>
            <Radio value="tent" label="Tent" />
            <Radio value="cabin" label="Cabin" />
          </RadioGroup>
          <p>Chosen: {value}</p>
        </>
      );
    }
    render(<Controlled />);
    expect(screen.getByRole('radio', { name: 'Cabin' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Tent' }));
    expect(screen.getByText('Chosen: tent')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Tent' })).toBeChecked();
  });

  it('describes the group with its hint and error', () => {
    render(
      <RadioGroup legend="Release" hint="How the site opens" error="Choose one">
        <Radio value="daily" label="Daily" />
      </RadioGroup>
    );
    expect(screen.getByRole('group', { name: 'Release' })).toHaveAccessibleDescription(
      'How the site opens Choose one'
    );
  });
});
