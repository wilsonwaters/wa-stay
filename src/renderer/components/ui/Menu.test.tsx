import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ellipsis } from 'lucide-react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { IconButton } from './IconButton';
import { Menu, MenuItem } from './Menu';

function Actions({ onEdit = jest.fn(), onDelete = jest.fn() }) {
  return (
    <>
      <Menu trigger={<Button variant="secondary">Watch actions</Button>}>
        <MenuItem onSelect={onEdit}>Edit</MenuItem>
        <MenuItem href="#/watches/1">Open details</MenuItem>
        <MenuItem disabled>Duplicate</MenuItem>
        <MenuItem tone="danger" onSelect={onDelete}>
          Delete
        </MenuItem>
      </Menu>
      <button type="button">After</button>
    </>
  );
}

const trigger = () => screen.getByRole('button', { name: 'Watch actions' });
const item = (name: string) => screen.getByRole('menuitem', { name });

describe('Menu', () => {
  it('marks its trigger as a menu button and reflects the open state in aria-expanded', async () => {
    render(<Actions />);
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Watch actions' })).toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-controls', screen.getByRole('menu').id);
    await userEvent.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('is operable by keyboard: ↑/↓ wrap, Home/End, disabled items skipped, Enter activates', async () => {
    const onEdit = jest.fn();
    const user = userEvent.setup();
    render(<Actions onEdit={onEdit} />);
    trigger().focus();
    await user.keyboard('{Enter}');
    expect(item('Edit')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Open details')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Delete')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Edit')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(item('Delete')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(item('Edit')).toHaveFocus();
    await user.keyboard('{End}');
    expect(item('Delete')).toHaveFocus();
    await user.keyboard('{Home}{Enter}');
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it('activates with Space, and opens on ↓ (first item) and ↑ (last item) from the trigger', async () => {
    const onDelete = jest.fn();
    const user = userEvent.setup();
    render(<Actions onDelete={onDelete} />);
    trigger().focus();
    await user.keyboard('{ArrowUp}');
    expect(item('Delete')).toHaveFocus();
    await user.keyboard(' ');
    expect(onDelete).toHaveBeenCalledTimes(1);

    await user.keyboard('{ArrowDown}');
    expect(item('Edit')).toHaveFocus();
  });

  it('closes on Escape and on Tab, returning focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Actions />);
    await user.click(trigger());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{Enter}');
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it('supports link items and disabled items', async () => {
    render(<Actions />);
    await userEvent.click(trigger());
    expect(item('Open details')).toHaveAttribute('href', '#/watches/1');
    expect(item('Duplicate')).toHaveAttribute('aria-disabled', 'true');
  });

  it('closes on a click outside', async () => {
    render(<Actions />);
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('button', { name: 'After' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('works with an IconButton trigger and keeps Escape from closing a surrounding dialog', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(
      <Dialog open onClose={onClose} title="Watch">
        <Menu trigger={<IconButton label="More actions" icon={<Ellipsis />} />}>
          <MenuItem>Pause</MenuItem>
        </Menu>
      </Dialog>
    );
    const more = screen.getByRole('button', { name: 'More actions' });
    await user.click(more);
    expect(screen.getByRole('menu', { name: 'More actions' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(more).toHaveFocus();
  });
});
