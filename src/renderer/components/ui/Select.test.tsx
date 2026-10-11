import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { Field } from './Field';
import { Select } from './Select';

describe('Select', () => {
  it('is a native labelled select that works with register', async () => {
    const onValid = jest.fn();
    function Form() {
      const { register, handleSubmit } = useForm<{ interval: string }>({
        defaultValues: { interval: '60' },
      });
      return (
        <form onSubmit={handleSubmit(onValid)}>
          <Field label="Check every" hint="How often WA Stay checks for openings">
            <Select {...register('interval')}>
              <option value="60">Hour</option>
              <option value="240">4 hours</option>
            </Select>
          </Field>
          <button type="submit">Save</button>
        </form>
      );
    }
    render(<Form />);
    const select = screen.getByRole('combobox', { name: 'Check every' });
    expect(select).toHaveAccessibleDescription('How often WA Stay checks for openings');
    await userEvent.selectOptions(select, '4 hours');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onValid).toHaveBeenCalledWith({ interval: '240' }, expect.anything());
  });
});
