import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Disclosure } from './Disclosure';

describe('Disclosure', () => {
  it('toggles aria-expanded and hides its region when collapsed', async () => {
    render(<Disclosure summary="Advanced options">Poll every 2 seconds</Disclosure>);
    const button = screen.getByRole('button', { name: 'Advanced options' });
    const region = document.getElementById(button.getAttribute('aria-controls') ?? '');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(region).not.toBeVisible();

    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(region).toBeVisible();
    expect(region).toHaveTextContent('Poll every 2 seconds');

    await userEvent.keyboard(' ');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(region).not.toBeVisible();
  });

  it('can start open and be controlled', async () => {
    const onOpenChange = jest.fn();
    const { rerender } = render(
      <Disclosure summary="Details" open={false} onOpenChange={onOpenChange}>
        Body
      </Disclosure>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    rerender(
      <Disclosure summary="Details" open onOpenChange={onOpenChange}>
        Body
      </Disclosure>
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Body')).toBeVisible();
  });

  it('can title a part of the page: its button inside a heading of the level given', async () => {
    render(
      <Disclosure summary="Fees" headingLevel={3} size="md">
        Ten dollars
      </Disclosure>
    );
    const heading = screen.getByRole('heading', { level: 3, name: 'Fees' });
    const button = screen.getByRole('button', { name: 'Fees' });
    expect(heading).toContainElement(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    expect(screen.getByText('Ten dollars')).toBeVisible();
  });

  it('has no heading unless asked', () => {
    render(<Disclosure summary="Advanced options">Body</Disclosure>);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
