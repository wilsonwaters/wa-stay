import { render, screen } from '@testing-library/react';
import type { UnitSummary } from '../../../shared/types/catalog.types';
import { MinStayNotice, minStayWarning, type MinStayInput } from './MinStayNotice';

const CABINS = { one: 'cabin', many: 'cabins' };
const cabin = (id: string, minNights?: number, extra: Partial<UnitSummary> = {}): UnitSummary => ({
  unitId: id,
  unitName: `Cabin ${id}`,
  unitKind: 'cabin',
  ...(minNights !== undefined ? { minNights } : {}),
  ...extra,
});

/** A 2-night stay at Busselton, nothing chosen. */
const input = (overrides: Partial<MinStayInput> = {}): MinStayInput => ({
  units: [cabin('1', 3), cabin('2', 3)],
  unitIds: [],
  arrival: '2027-09-25',
  departure: '2027-09-27',
  place: 'Busselton',
  noun: CABINS,
  shortName: 'RAC',
  action: 'alerts on',
  ...overrides,
});

const EVERY =
  "Busselton's cabins need at least 3 nights. WA Stay only alerts on stays RAC accepts.";

describe('minStayWarning', () => {
  it('names the place when every unit it is about needs more nights than the stay', () => {
    expect(minStayWarning(input())).toBe(EVERY);
    // The smallest minimum among them
    expect(minStayWarning(input({ units: [cabin('1', 5), cabin('2', 3)] }))).toBe(EVERY);
    // A snipe holds rather than alerts
    expect(minStayWarning(input({ action: 'holds' }))).toBe(
      "Busselton's cabins need at least 3 nights. WA Stay only holds stays RAC accepts."
    );
  });

  it('says "Some" when only some of them do', () => {
    const units = [cabin('1', 3), cabin('2'), cabin('3', 4)];
    expect(minStayWarning(input({ units }))).toBe('Some cabins need at least 3 nights.');
  });

  it('is about the chosen units, by id or name, else those of the chosen stay types', () => {
    const units = [cabin('1', 3), cabin('2'), { ...cabin('s', 4), unitKind: 'campsite' as const }];
    expect(minStayWarning(input({ units, unitIds: ['1'] }))).toBe(EVERY);
    expect(minStayWarning(input({ units, unitIds: ['Cabin 2'] }))).toBeUndefined();
    // The units it is about are named by their own kind (R9): the campsite is a site
    expect(minStayWarning(input({ units, unitKinds: ['campsite'] }))).toBe(
      "Busselton's sites need at least 4 nights. WA Stay only alerts on stays RAC accepts."
    );
    expect(minStayWarning(input({ units, unitKinds: ['cabin'] }))).toBe(
      'Some cabins need at least 3 nights.'
    );
  });

  it('says nothing for a stay long enough, or units with no rule (none, 0, 1, negative, a fraction)', () => {
    expect(minStayWarning(input({ departure: '2027-09-28' }))).toBeUndefined();
    for (const minNights of [undefined, 0, 1, -3, 3.5]) {
      expect(minStayWarning(input({ units: [cabin('1', minNights)] }))).toBeUndefined();
    }
  });

  it('says nothing before the dates are chosen, or before the units load', () => {
    expect(minStayWarning(input({ arrival: '', departure: '' }))).toBeUndefined();
    expect(minStayWarning(input({ departure: '' }))).toBeUndefined();
    expect(minStayWarning(input({ departure: '2027-09-25' }))).toBeUndefined();
    expect(minStayWarning(input({ units: undefined }))).toBeUndefined();
    expect(minStayWarning(input({ units: [] }))).toBeUndefined();
  });

  it('says "These" when the place is not known', () => {
    expect(minStayWarning(input({ place: undefined }))).toBe(
      'These cabins need at least 3 nights. WA Stay only alerts on stays RAC accepts.'
    );
  });
});

describe('MinStayNotice', () => {
  it('is a warning status, announced when it appears, and gone when the stay is long enough', () => {
    const { rerender } = render(<MinStayNotice {...input({ departure: '2027-09-28' })} />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<MinStayNotice {...input()} />);
    expect(screen.getByRole('status')).toHaveTextContent(EVERY);
    rerender(<MinStayNotice {...input({ departure: '2027-09-28' })} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
