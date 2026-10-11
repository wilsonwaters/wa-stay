import { render, screen } from '@testing-library/react';
import { BellRing } from 'lucide-react';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('has a heading, a description and the next step', () => {
    render(
      <EmptyState
        icon={<BellRing size={24} />}
        title="No watches yet"
        description="Pick a place and dates, and WA Stay checks for openings every few minutes."
        actions={<Button>Create watch</Button>}
        accent="sun"
      />
    );
    expect(screen.getByRole('heading', { level: 2, name: 'No watches yet' })).toBeInTheDocument();
    expect(screen.getByText(/checks for openings/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create watch' })).toBeInTheDocument();
    // The icon and the brush accent are decorative.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('uses a display title by default, and a section-size title under a page h1', () => {
    const { rerender } = render(<EmptyState title="WA Stay hit a problem" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveClass(
      'font-display',
      'text-display-sm'
    );
    rerender(<EmptyState title="The map is on its way" size="md" />);
    const title = screen.getByRole('heading', { level: 2 });
    // Smaller than the page h1 (text-2xl), and Figtree: Fraunces is for 28 px and up.
    expect(title).toHaveClass('text-xl', 'font-semibold');
    expect(title).not.toHaveClass('font-display');
  });

  it('can use an h3 inside a section', () => {
    render(<EmptyState title="No results" headingLevel={3} />);
    expect(screen.getByRole('heading', { level: 3, name: 'No results' })).toBeInTheDocument();
  });

  it("can be a page's h1 when it is the whole page", () => {
    render(<EmptyState title="This place isn't available" headingLevel={1} />);
    expect(
      screen.getByRole('heading', { level: 1, name: "This place isn't available" })
    ).toBeInTheDocument();
  });
});
