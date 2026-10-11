import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Menu, MenuItem } from './Menu';
import { Popover } from './Popover';
import { TextField } from './TextField';

/** Renders into a `#root`, as the app does, so `inert` can be asserted. */
function renderInRoot(ui: React.ReactElement) {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  return { root, ...render(ui, { container: root }) };
}

function EditDialog({ closeOnOverlayClick = true }: { closeOnOverlayClick?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Edit watch</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Edit watch"
        description="Changes apply from the next check."
        closeOnOverlayClick={closeOnOverlayClick}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Save changes</Button>
          </>
        }
      >
        <TextField aria-label="Watch name" />
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('is a modal dialog named by its title and described by its description', async () => {
    renderInRoot(<EditDialog />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit watch' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit watch' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Changes apply from the next check.');
  });

  it('on open moves focus inside, traps Tab and Shift+Tab, makes #root inert and locks scroll', async () => {
    const user = userEvent.setup();
    const { root } = renderInRoot(<EditDialog />);
    await user.click(screen.getByRole('button', { name: 'Edit watch' }));
    const dialog = screen.getByRole('dialog');

    // The close button is skipped for initial focus: the first field gets it.
    expect(within(dialog).getByRole('textbox', { name: 'Watch name' })).toHaveFocus();
    expect(root).toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('hidden');

    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toHaveFocus();
  });

  it('closes on Escape and returns focus to the opener, removing inert', async () => {
    const user = userEvent.setup();
    const { root } = renderInRoot(<EditDialog />);
    const opener = screen.getByRole('button', { name: 'Edit watch' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(root).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on an overlay click unless told not to', async () => {
    const user = userEvent.setup();
    const { unmount } = renderInRoot(<EditDialog />);
    await user.click(screen.getByRole('button', { name: 'Edit watch' }));
    const scrim = screen.getByRole('dialog').previousElementSibling as HTMLElement;
    await user.click(scrim);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();

    renderInRoot(<EditDialog closeOnOverlayClick={false} />);
    await user.click(screen.getByRole('button', { name: 'Edit watch' }));
    await user.click(screen.getByRole('dialog').previousElementSibling as HTMLElement);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('removes inert when the open dialog unmounts without closing (route change)', async () => {
    function Page({ show }: { show: boolean }) {
      return show ? (
        <Dialog open onClose={() => undefined} title="Details">
          Body
        </Dialog>
      ) : null;
    }
    const { root, rerender } = renderInRoot(<Page show />);
    expect(root).toHaveAttribute('inert');
    rerender(<Page show={false} />);
    expect(root).not.toHaveAttribute('inert');
  });

  it('stacks: Escape closes the innermost dialog first, and the lower one is inert meanwhile', async () => {
    const user = userEvent.setup();
    function Stacked() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(false);
      return (
        <>
          <Dialog open={outer} onClose={() => setOuter(false)} title="Outer">
            <Button onClick={() => setInner(true)}>Open inner</Button>
          </Dialog>
          <Dialog open={inner} onClose={() => setInner(false)} title="Inner">
            <Button>Inside inner</Button>
          </Dialog>
        </>
      );
    }
    renderInRoot(<Stacked />);
    await user.click(screen.getByRole('button', { name: 'Open inner' }));
    const outerRoot = screen.getByRole('dialog', { name: 'Outer', hidden: true }).parentElement;
    expect(outerRoot).toHaveAttribute('inert');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Inner' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument();
    expect(outerRoot).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'Open inner' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a Popover inside a Dialog closes on Escape without closing the Dialog', async () => {
    const user = userEvent.setup();
    renderInRoot(
      <Dialog open onClose={jest.fn()} title="Filters">
        <Popover label="More filters" trigger={<Button variant="secondary">More</Button>}>
          <Button>Apply</Button>
        </Popover>
      </Dialog>
    );
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('dialog', { name: 'More filters' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'More filters' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toHaveFocus();
  });

  it('opened from a Menu item, returns focus to the Menu trigger', async () => {
    const user = userEvent.setup();
    function Actions() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Menu trigger={<Button variant="secondary">Actions</Button>}>
            <MenuItem onSelect={() => setOpen(true)}>Rename</MenuItem>
          </Menu>
          <Dialog open={open} onClose={() => setOpen(false)} title="Rename">
            <TextField aria-label="Name" />
          </Dialog>
        </>
      );
    }
    renderInRoot(<Actions />);
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(screen.getByRole('dialog', { name: 'Rename' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Actions' })).toHaveFocus();
  });

  it('ignores Escape when closeOnEsc is false', async () => {
    const onClose = jest.fn();
    renderInRoot(
      <Dialog open onClose={onClose} title="Saving" closeOnEsc={false}>
        Please wait
      </Dialog>
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(['sm', 'md', 'lg', 'full'] as const)('renders the %s size', (size) => {
    renderInRoot(
      <Dialog open onClose={jest.fn()} title={`Size ${size}`} size={size}>
        Body
      </Dialog>
    );
    expect(screen.getByRole('dialog', { name: `Size ${size}` })).toBeInTheDocument();
  });
});
