import { render, screen } from '@testing-library/react';
import { BookingStatus, SnipeResult, SnipeStatus, WatchResult } from '@shared/types';
import { StatusPill } from './StatusPill';
import { statusPresets } from './statusPresets';

describe('StatusPill', () => {
  it('shows an icon and a text label, not colour alone', () => {
    render(<StatusPill {...statusPresets.snipe[SnipeStatus.HELD]} />);
    const pill = screen.getByText('Site held');
    expect(pill.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('replaces the icon with a decorative pulsing dot when live', () => {
    render(<StatusPill {...statusPresets.watch.active} />);
    const pill = screen.getByText('Watching');
    expect(statusPresets.watch.active.live).toBe(true);
    expect(pill.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(pill.querySelector('svg')).toBeNull();
  });
});

describe('statusPresets', () => {
  const cases: [string, Record<string, string>, Record<string, unknown>][] = [
    ['WatchResult', WatchResult, statusPresets.watchResult],
    ['SnipeStatus', SnipeStatus, statusPresets.snipe],
    ['SnipeResult', SnipeResult, statusPresets.snipeResult],
    ['BookingStatus', BookingStatus, statusPresets.booking],
  ];

  it.each(cases)('covers every %s value with a label, tone and icon', (_name, values, presets) => {
    for (const value of Object.values(values)) {
      const preset = presets[value] as { label: string; tone: string; icon: unknown };
      expect(preset).toBeDefined();
      expect(preset.label).toMatch(/^[A-Z][a-z]/);
      expect(preset.tone).toBeTruthy();
      expect(preset.icon).toBeTruthy();
    }
    expect(Object.keys(presets).sort()).toEqual(Object.values(values).sort());
  });

  it('covers a watch being active, paused or ended', () => {
    expect(Object.keys(statusPresets.watch).sort()).toEqual(['active', 'ended', 'paused']);
  });
});
