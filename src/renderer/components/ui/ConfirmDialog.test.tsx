import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

const renderInRoot = (ui: React.ReactElement) => {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  return render(ui, { container: root });
};

describe('ConfirmDialog', () => {
  it('is an alertdialog named by its title, described by its message, and focuses Cancel for danger', () => {
    renderInRoot(
      <ConfirmDialog
        open
        title="Delete watch"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Delete watch' });
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('focuses the confirm button first for the primary tone', () => {
    renderInRoot(
      <ConfirmDialog
        open
        tone="primary"
        title="Arm snipe"
        message="WA Stay will try at midnight."
        confirmLabel="Arm"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Arm' })).toHaveFocus();
  });

  it('shows loading on confirm until an async onConfirm resolves', async () => {
    let resolve: () => void = () => undefined;
    const onConfirm = jest.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    const onCancel = jest.fn();
    renderInRoot(
      <ConfirmDialog
        open
        title="Delete booking"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    const confirm = screen.getByRole('button', { name: 'Delete' });
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    // Loading keeps the pressed button focusable, so focus does not fall to the body.
    expect(confirm).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();

    await import('@testing-library/react').then(({ act }) =>
      act(async () => {
        resolve();
      })
    );
    expect(confirm).not.toHaveAttribute('aria-busy');
    expect(confirm).not.toHaveAttribute('aria-disabled');
  });

  it('catches a rejected onConfirm: stays open, shows the error and lets you try again', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    const user = userEvent.setup();
    const onConfirm = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error("ParkStay didn't respond. Try again in a minute."))
      .mockRejectedValueOnce('not an Error')
      .mockResolvedValueOnce(undefined);
    renderInRoot(
      <ConfirmDialog
        open
        title="Cancel booking"
        message="Your site is released."
        confirmLabel="Cancel booking"
        cancelLabel="Keep booking"
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Cancel booking' });
    const confirm = screen.getByRole('button', { name: 'Cancel booking' });

    await user.click(confirm);
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      "ParkStay didn't respond. Try again in a minute."
    );
    expect(confirm).not.toHaveAttribute('aria-busy');
    expect(confirm).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button', { name: 'Keep booking' })).toBeEnabled();

    await user.click(confirm);
    expect(within(dialog).getByRole('alert')).toHaveTextContent("That didn't work. Try again.");

    await user.click(confirm);
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    expect(onConfirm).toHaveBeenCalledTimes(3);

    // Let Node report any rejection nobody handled.
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('catches an onConfirm that throws synchronously', async () => {
    renderInRoot(
      <ConfirmDialog
        open
        title="Delete"
        message="Sure?"
        onConfirm={() => {
          throw new Error('Database is locked');
        }}
        onCancel={jest.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Database is locked');
  });

  it('calls onCancel from Cancel and Escape, and renders nothing when closed', async () => {
    const onCancel = jest.fn();
    const { rerender } = renderInRoot(
      <ConfirmDialog
        open
        title="Delete"
        message="Sure?"
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(2);
    rerender(
      <ConfirmDialog
        open={false}
        title="Delete"
        message="Sure?"
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('a synchronous onConfirm does not show loading', async () => {
    const onConfirm = jest.fn();
    renderInRoot(
      <ConfirmDialog
        open
        title="Delete"
        message="Sure?"
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Confirm' })).not.toHaveAttribute('aria-busy');
  });
});
