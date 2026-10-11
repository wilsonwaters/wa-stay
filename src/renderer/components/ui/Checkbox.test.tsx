import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('is a native checkbox named by its label and described by its description', async () => {
    render(<Checkbox label="Email me when found" description="Uses your email notifier" />);
    const box = screen.getByRole('checkbox', { name: 'Email me when found' });
    expect(box).toHaveAccessibleDescription('Uses your email notifier');
    expect(box).not.toBeChecked();
    await userEvent.click(screen.getByText('Email me when found'));
    expect(box).toBeChecked();
    await userEvent.keyboard(' ');
    expect(box).not.toBeChecked();
  });

  it('works with react-hook-form register', async () => {
    const onValid = jest.fn();
    function Form() {
      const { register, handleSubmit } = useForm<{ partial: boolean }>();
      return (
        <form onSubmit={handleSubmit(onValid)}>
          <Checkbox label="Allow partial matches" {...register('partial')} />
          <button type="submit">Save</button>
        </form>
      );
    }
    render(<Form />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Allow partial matches' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onValid).toHaveBeenCalledWith({ partial: true }, expect.anything());
  });

  it('can be disabled', () => {
    render(<Checkbox label="Hold a site automatically" disabled />);
    expect(screen.getByRole('checkbox', { name: 'Hold a site automatically' })).toBeDisabled();
  });
});
