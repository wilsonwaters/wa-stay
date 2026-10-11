import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { Field } from './Field';
import { Textarea } from './Textarea';

describe('Textarea', () => {
  it('is a labelled multi-line textbox that works with register', async () => {
    const onValid = jest.fn();
    function Form() {
      const { register, handleSubmit } = useForm<{ notes: string }>();
      return (
        <form onSubmit={handleSubmit(onValid)}>
          <Field label="Notes" error="Too long">
            <Textarea {...register('notes')} />
          </Field>
          <button type="submit">Save</button>
        </form>
      );
    }
    render(<Form />);
    const notes = screen.getByRole('textbox', { name: 'Notes' });
    expect(notes.tagName).toBe('TEXTAREA');
    expect(notes).toHaveAttribute('aria-invalid', 'true');
    await userEvent.type(notes, 'Near the water');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onValid).toHaveBeenCalledWith({ notes: 'Near the water' }, expect.anything());
  });
});
