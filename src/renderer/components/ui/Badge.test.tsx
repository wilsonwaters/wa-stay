import { render, screen } from '@testing-library/react';
import { Clock } from 'lucide-react';
import { Badge, type BadgeTone } from './Badge';

const TONES: BadgeTone[] = ['neutral', 'brand', 'accent', 'available', 'warning', 'danger', 'sun'];

describe('Badge', () => {
  it.each(TONES)('the %s tone always carries text', (tone) => {
    render(<Badge tone={tone}>{`${tone} label`}</Badge>);
    expect(screen.getByText(`${tone} label`)).toBeVisible();
  });

  it('keeps its icon decorative', () => {
    render(<Badge icon={<Clock size={14} />}>Soon</Badge>);
    const badge = screen.getByText('Soon');
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
