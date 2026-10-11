import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { Search } from 'lucide-react';
import { Field } from './Field';
import { TextField } from './TextField';

describe('TextField', () => {
  it('works with react-hook-form register (forwardRef)', async () => {
    const onValid = jest.fn();
    function Form() {
      const { register, handleSubmit } = useForm<{ name: string }>();
      return (
        <form onSubmit={handleSubmit(onValid)}>
          <Field label="Name">
            <TextField {...register('name')} />
          </Field>
          <button type="submit">Save</button>
        </form>
      );
    }
    render(<Form />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Lucky Bay');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onValid).toHaveBeenCalledWith({ name: 'Lucky Bay' }, expect.anything());
  });

  it('keeps a leading icon decorative', () => {
    render(<TextField aria-label="Search places" leadingIcon={<Search />} />);
    expect(screen.getByRole('textbox')).toHaveAccessibleName('Search places');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('can be disabled', () => {
    render(<TextField aria-label="Name" disabled />);
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeDisabled();
  });
});
