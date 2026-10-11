import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { photoUrls } from '../../../../tests/fixtures/catalog/place-detail';
import { Gallery } from './Gallery';

function renderGallery(urls: string[]) {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  const user = userEvent.setup();
  const view = render(<Gallery name="Bungarra" kind="campground" imageUrls={urls} />, {
    container: root,
  });
  return { ...view, user };
}

afterEach(() => {
  document.getElementById('root')?.remove();
});

describe('Gallery', () => {
  it('shows one large photo and 4 tiles from 12, with "Show all 12 photos"', () => {
    renderGallery(photoUrls(12));
    const photos = screen.getAllByRole('img');
    expect(photos.map((img) => img.getAttribute('alt'))).toEqual([
      'Bungarra, photo 1 of 12',
      'Bungarra, photo 2 of 12',
      'Bungarra, photo 3 of 12',
      'Bungarra, photo 4 of 12',
      'Bungarra, photo 5 of 12',
    ]);
    // Photos are hot-linked with no referrer.
    expect(photos[0]).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.getByRole('button', { name: 'Show all 12 photos' })).toBeInTheDocument();
  });

  it('opens every photo in a dialog: arrow keys, "3 of 12", Escape, focus back', async () => {
    const { user } = renderGallery(photoUrls(12));
    const showAll = screen.getByRole('button', { name: 'Show all 12 photos' });
    await user.click(showAll);

    const dialog = screen.getByRole('dialog', { name: 'Photos of Bungarra' });
    expect(
      within(dialog).getByRole('img', { name: 'Bungarra, photo 1 of 12' })
    ).toBeInTheDocument();
    expect(within(dialog).getByText('1 of 12')).toBeInTheDocument();

    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(within(dialog).getByText('3 of 12')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('img', { name: 'Bungarra, photo 3 of 12' })
    ).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    // Before the first comes the last.
    expect(within(dialog).getByText('12 of 12')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Next photo' }));
    expect(within(dialog).getByText('1 of 12')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(showAll).toHaveFocus();
  });

  it('opens the dialog at the photo pressed', async () => {
    const { user } = renderGallery(photoUrls(12));
    await user.click(screen.getByRole('button', { name: 'Bungarra, photo 4 of 12' }));
    expect(
      within(screen.getByRole('dialog')).getByRole('img', { name: 'Bungarra, photo 4 of 12' })
    ).toBeInTheDocument();
  });

  it('shows a single photo as one hero, with nothing to open', () => {
    renderGallery(photoUrls(1));
    expect(screen.getByRole('img', { name: 'Bungarra, photo 1 of 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the placeholder when there is no photo', () => {
    renderGallery([]);
    expect(
      screen.getByRole('img', { name: 'No photo available for Bungarra' })
    ).toBeInTheDocument();
  });

  it('leaves out photos that are not https', () => {
    renderGallery(['http://insecure.example/a.jpg', 'data:image/png;base64,AA']);
    expect(
      screen.getByRole('img', { name: 'No photo available for Bungarra' })
    ).toBeInTheDocument();
  });

  it('shows the placeholder for a photo that fails, and leaves it out of the count', async () => {
    const { user } = renderGallery(photoUrls(12));
    fireEvent.error(screen.getByRole('img', { name: 'Bungarra, photo 3 of 12' }));
    expect(
      screen.getByRole('img', { name: 'No photo available for Bungarra' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all 11 photos' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Bungarra, photo 3 of 11' })).toHaveAttribute(
      'src',
      photoUrls(12)[3]
    );

    await user.click(screen.getByRole('button', { name: 'Show all 11 photos' }));
    const dialog = screen.getByRole('dialog', { name: 'Photos of Bungarra' });
    await user.keyboard('{ArrowLeft}');
    expect(within(dialog).getByText('11 of 11')).toBeInTheDocument();
  });
});
