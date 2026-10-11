import { render, screen } from '@testing-library/react';
import { Field } from './Field';
import { TextField } from './TextField';

describe('Field', () => {
  it('labels its control', () => {
    render(
      <Field label="Watch name">
        <TextField />
      </Field>
    );
    expect(screen.getByRole('textbox', { name: 'Watch name' })).toBeInTheDocument();
  });

  it('with an error, marks the control invalid and describes it with the error text', () => {
    render(
      <Field label="Email" error="Enter an email address like name@example.com">
        <TextField />
      </Field>
    );
    const input = screen.getByRole('textbox', { name: 'Email' });
    const error = screen.getByText('Enter an email address like name@example.com');
    const errorId = error.closest('p')?.id;

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(errorId).toBeTruthy();
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(errorId);
    expect(input).toHaveAccessibleDescription('Enter an email address like name@example.com');
  });

  it('includes both hint and error ids in aria-describedby, hint first', () => {
    render(
      <Field label="Postcode" hint="Used for concession pricing" error="Enter a 4-digit postcode">
        <TextField />
      </Field>
    );
    const input = screen.getByRole('textbox', { name: 'Postcode' });
    const hintId = screen.getByText('Used for concession pricing').id;
    const errorId = screen.getByText('Enter a 4-digit postcode').closest('p')?.id;
    expect(input.getAttribute('aria-describedby')).toBe(`${hintId} ${errorId}`);
    expect(input).toHaveAccessibleDescription(
      'Used for concession pricing Enter a 4-digit postcode'
    );
  });

  it('with only a hint, describes the control and leaves it valid', () => {
    render(
      <Field label="Nickname" hint="Shown on your watches">
        <TextField />
      </Field>
    );
    const input = screen.getByRole('textbox', { name: 'Nickname' });
    expect(input).toHaveAccessibleDescription('Shown on your watches');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('shows the error with an icon as well as colour', () => {
    render(
      <Field label="Email" error="Required">
        <TextField />
      </Field>
    );
    const error = screen.getByText('Required').closest('p');
    expect(error?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('sets aria-required when required, and marks optional fields in the label', () => {
    render(
      <>
        <Field label="Name" required>
          <TextField />
        </Field>
        <Field label="Phone" optional>
          <TextField />
        </Field>
      </>
    );
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('textbox', { name: 'Phone (optional)' })).not.toHaveAttribute(
      'aria-required'
    );
  });

  it('keeps the control’s own id and aria-describedby', () => {
    render(
      <>
        <p id="extra">Extra help</p>
        <Field label="Notes" hint="Private to you">
          <TextField id="notes" aria-describedby="extra" />
        </Field>
      </>
    );
    const input = screen.getByRole('textbox', { name: 'Notes' });
    expect(input).toHaveAttribute('id', 'notes');
    expect(input).toHaveAccessibleDescription('Extra help Private to you');
  });
});
