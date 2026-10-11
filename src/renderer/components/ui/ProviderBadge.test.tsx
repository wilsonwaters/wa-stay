import { render, screen } from '@testing-library/react';
import { readableTextOn } from './brandContrast';
import { ProviderBadge, ProviderManifestsProvider, type ProviderBadgeInfo } from './ProviderBadge';

const PARKSTAY: ProviderBadgeInfo = {
  id: 'parkstay',
  name: 'ParkStay WA',
  shortName: 'ParkStay',
  brand: { color: '#2D6A4F', monogram: 'PS' }, // token-guard-ignore: provider brand colour is data
};

describe('ProviderBadge', () => {
  it('full variant shows the monogram and short name, named by the provider name', () => {
    render(<ProviderBadge providerId="parkstay" info={PARKSTAY} />);
    const badge = screen.getByRole('img', { name: 'ParkStay WA' });
    expect(badge).toHaveTextContent('PS');
    expect(badge).toHaveTextContent('ParkStay');
  });

  it('compact variant shows only the monogram; its accessible name is the provider name', () => {
    render(<ProviderBadge providerId="parkstay" info={PARKSTAY} variant="compact" size="sm" />);
    const badge = screen.getByRole('img', { name: 'ParkStay WA' });
    expect(badge).toHaveTextContent(/^PS$/);
    expect(badge).toHaveAttribute('title', 'ParkStay WA');
  });

  it('looks the provider up in ProviderManifestsContext when info is omitted', () => {
    render(
      <ProviderManifestsProvider manifests={[PARKSTAY]}>
        <ProviderBadge providerId="parkstay" />
      </ProviderManifestsProvider>
    );
    expect(screen.getByRole('img', { name: 'ParkStay WA' })).toHaveTextContent('ParkStay');
  });

  it('an unknown provider shows its id and is named "Unknown provider"', () => {
    render(
      <ProviderManifestsProvider manifests={[PARKSTAY]}>
        <ProviderBadge providerId="rac" />
        <ProviderBadge providerId="hipcamp" variant="compact" />
      </ProviderManifestsProvider>
    );
    const [full, compact] = screen.getAllByRole('img', { name: 'Unknown provider' });
    expect(full).toHaveTextContent('rac');
    expect(compact).toHaveTextContent('hipcamp');
  });

  it('accepts a full provider manifest as info (structural type)', () => {
    const manifest = {
      ...PARKSTAY,
      description: 'National park campgrounds',
      website: 'https://parkstay.dbca.wa.gov.au',
      integration: 'api' as const,
      timezone: 'Australia/Perth',
    };
    render(<ProviderBadge providerId="parkstay" info={manifest} />);
    expect(screen.getByRole('img', { name: 'ParkStay WA' })).toBeInTheDocument();
  });
});

describe('readableTextOn', () => {
  it('picks white text on dark brand colours and ink on light ones', () => {
    expect(readableTextOn('#2D6A4F')).toMatchObject({ fill: 'solid', text: 'fg-inverse' }); // token-guard-ignore: test colour
    expect(readableTextOn('#F2B91F')).toMatchObject({ fill: 'solid', text: 'fg' }); // token-guard-ignore: test colour
    expect(readableTextOn('#000')).toMatchObject({ fill: 'solid', text: 'fg-inverse' }); // token-guard-ignore: test colour
  });

  it('falls back to outlined for mid grey (777777), where neither text reaches 4.5:1', () => {
    const look = readableTextOn('#777777'); // token-guard-ignore: the spec's example colour
    expect(look.fill).toBe('outlined');
    expect(look.ratio).toBeCloseTo(4.48, 2);
  });

  it('treats a colour that is not hex as outlined', () => {
    expect(readableTextOn('green').fill).toBe('outlined');
  });

  it('renders the outlined style with surface fill and ink text', () => {
    render(
      <ProviderBadge
        providerId="grey"
        info={{ ...PARKSTAY, brand: { color: '#777777', monogram: 'GR' } }} // token-guard-ignore: test colour
      />
    );
    const monogram = screen.getByText('GR');
    expect(monogram).toHaveStyle({ borderColor: '#777777' }); // token-guard-ignore: test colour
    expect(monogram.style.backgroundColor).toBe('');
  });
});
