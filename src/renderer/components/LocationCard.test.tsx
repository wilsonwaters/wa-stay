import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { LocationSummary } from '../../shared/types/catalog.types';
import { LocationCard, LocationPhoto, photoUrl } from './LocationCard';

const PLACE: LocationSummary = {
  key: 'parkstay:20',
  providerId: 'parkstay',
  externalId: '20',
  name: 'Bungarra',
  kind: 'campground',
  bookingMode: 'online',
  lat: -22.247,
  lng: 113.84,
  area: { name: 'Cape Range National Park', region: 'Pilbara' },
  imageUrls: ['https://parkstay.dbca.wa.gov.au/media/bungarra.jpg'],
  amenities: [],
};

describe('LocationPhoto', () => {
  it('loads only https photos', () => {
    expect(photoUrl(['https://example.org/a.jpg', 'http://example.org/b.jpg'])).toBe(
      'https://example.org/a.jpg'
    );
    for (const url of [
      'http://example.org/a.jpg',
      'file:///etc/passwd',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      '//example.org/a.jpg',
      'not a url',
    ]) {
      expect(photoUrl([url])).toBeUndefined();
    }
    expect(photoUrl([])).toBeUndefined();
  });

  it('shows the placeholder, and requests nothing, for a photo that is not https', () => {
    const { container } = render(
      <LocationPhoto location={{ ...PLACE, imageUrls: ['http://example.org/bungarra.jpg'] }} />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(
      screen.getByRole('img', { name: 'No photo available for Bungarra' })
    ).toBeInTheDocument();
  });
});

describe('LocationPhoto alt text', () => {
  it('is decorative by default, beside the place name, and takes the name where it stands for it', () => {
    const photo = { ...PLACE, imageUrls: ['https://example.org/bungarra.jpg'] };
    const { container, rerender } = render(<LocationPhoto location={photo} />);
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
    rerender(<LocationPhoto location={photo} alt="Bungarra" />);
    expect(container.querySelector('img')).toHaveAttribute('alt', 'Bungarra');
    expect(container.querySelector('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('takes a record with no kind (a watch keeps none): the placeholder has a map pin', () => {
    render(<LocationPhoto location={{ name: 'Old place', imageUrls: [] }} alt="Old place" />);
    expect(
      screen.getByRole('img', { name: 'No photo available for Old place' })
    ).toBeInTheDocument();
  });
});

describe('LocationCard', () => {
  it('is one link named by the place, with its area in full, and marked current when selected', () => {
    const area = { name: 'Bandilngan (Windjana Gorge) National Park', region: 'Kimberley' };
    render(
      <MemoryRouter>
        <LocationCard location={{ ...PLACE, area }} selected />
      </MemoryRouter>
    );
    const card = screen.getByRole('link', { name: 'Bungarra' });
    expect(card).toHaveAttribute('href', '/places/parkstay/20');
    expect(card).toHaveAttribute('aria-current', 'true');
    // The region is never cut off: the line wraps (two lines at most) instead of truncating.
    expect(
      within(card).getByText('Bandilngan (Windjana Gorge) National Park · Kimberley')
    ).toBeInTheDocument();
    expect(card).toHaveAccessibleDescription(/Kimberley/);
  });
});
