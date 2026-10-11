import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';
import { BackLink, PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders one h1 with description, actions and a back link', () => {
    render(
      <PageHeader
        title="Watches"
        description="WA Stay checks these for openings."
        actions={<Button>Create watch</Button>}
        back={{ label: 'Explore', href: '#/' }}
      />
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Watches' })).toBeInTheDocument();
    expect(screen.getByText('WA Stay checks these for openings.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create watch' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '#/');
  });

  it('leads the title with a picture when given one', () => {
    render(
      <PageHeader
        title="Osprey Bay"
        media={<img src="https://example.org/a.jpg" alt="Osprey Bay" />}
      />
    );
    const header = screen.getByRole('banner');
    const photo = screen.getByRole('img', { name: 'Osprey Bay' });
    expect(header).toContainElement(photo);
    // The picture comes first in reading order, then the heading.
    expect(
      photo.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('puts a hero picture between the back link and the title', () => {
    render(
      <PageHeader
        title="Kurrajong"
        back={{ label: 'Bookings', href: '#/bookings' }}
        hero={<img src="https://example.org/k.jpg" alt="Kurrajong" />}
      />
    );
    const photo = screen.getByRole('img', { name: 'Kurrajong' });
    const back = screen.getByRole('link', { name: 'Bookings' });
    const heading = screen.getByRole('heading', { level: 1, name: 'Kurrajong' });
    expect(back.compareDocumentPosition(photo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(photo.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('BackLink: the same link on its own, which can take over the navigation', async () => {
    const onClick = jest.fn((event: { preventDefault(): void }) => event.preventDefault());
    render(
      <BackLink href="#/" onClick={onClick}>
        Explore
      </BackLink>
    );
    const link = screen.getByRole('link', { name: 'Explore' });
    expect(link).toHaveAttribute('href', '#/');
    await userEvent.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('has no back link unless asked', () => {
    render(<PageHeader title="Settings" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
