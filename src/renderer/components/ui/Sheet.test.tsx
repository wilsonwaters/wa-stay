import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sheet } from './Sheet';

describe('Sheet', () => {
  it('is a modal dialog with a close button, closed by Escape', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    const onClose = jest.fn();
    render(
      <Sheet open onClose={onClose} title="Filters">
        <p>Options</p>
      </Sheet>,
      { container: root }
    );
    const sheet = screen.getByRole('dialog', { name: 'Filters' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(root).toHaveAttribute('inert');
    // Only the close button is focusable, so it takes initial focus.
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
