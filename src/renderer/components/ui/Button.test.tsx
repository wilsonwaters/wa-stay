import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Plus } from 'lucide-react';
import { Button } from './Button';

describe('Button', () => {
  it.each(['primary', 'secondary', 'ghost', 'danger', 'floating', 'inverse'] as const)(
    'renders the %s variant as a button named by its label',
    (variant) => {
      render(<Button variant={variant}>Create watch</Button>);
      expect(screen.getByRole('button', { name: 'Create watch' })).toBeEnabled();
    }
  );

  it('renders a pill-shaped button, and a pill-shaped link, named by the label', () => {
    render(
      <>
        <Button shape="pill" variant="inverse" size="lg">
          Show map
        </Button>
        <Button as="a" href="#/places" shape="pill" variant="floating">
          View details
        </Button>
      </>
    );
    expect(screen.getByRole('button', { name: 'Show map' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'View details' })).toHaveAttribute('href', '#/places');
  });

  it('defaults to type="button" so it never submits a form by accident', async () => {
    const onSubmit = jest.fn((e) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Cancel</Button>
        <Button type="submit">Save changes</Button>
      </form>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('keeps its label while loading, sets aria-busy and aria-disabled, and ignores activation', async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(
      <Button loading onClick={onClick}>
        Save changes
      </Button>
    );
    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.click(button);
    await user.keyboard('{Enter} ');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('stays focused when it starts loading, so focus never drops to the body', async () => {
    const user = userEvent.setup();
    function Save() {
      const [loading, setLoading] = useState(false);
      return (
        <Button loading={loading} onClick={() => setLoading(true)}>
          Save changes
        </Button>
      );
    }
    render(<Save />);
    await user.tab();
    await user.keyboard('{Enter}');
    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    // Not natively disabled: Chromium moves focus off a button that becomes disabled.
    expect(button).toBeEnabled();
    expect(button).toHaveFocus();
  });

  it('does not submit its form again while loading', async () => {
    const onSubmit = jest.fn((e) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading>
          Save changes
        </Button>
      </form>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('is not busy when not loading', () => {
    render(<Button>Search</Button>);
    expect(screen.getByRole('button', { name: 'Search' })).not.toHaveAttribute('aria-busy');
  });

  it('renders a link with as="a"', () => {
    render(
      <Button as="a" href="#/watches" variant="secondary">
        All watches
      </Button>
    );
    const link = screen.getByRole('link', { name: 'All watches' });
    expect(link).toHaveAttribute('href', '#/watches');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('treats leading and trailing icons as decoration', () => {
    render(
      <Button leadingIcon={<Plus />} trailingIcon={<Plus />}>
        New watch
      </Button>
    );
    expect(screen.getByRole('button')).toHaveAccessibleName('New watch');
  });

  it('forwards its ref to the button', () => {
    const ref = { current: null as HTMLButtonElement | HTMLAnchorElement | null };
    render(<Button ref={ref}>Search</Button>);
    expect(ref.current).toBe(screen.getByRole('button'));
  });
});
