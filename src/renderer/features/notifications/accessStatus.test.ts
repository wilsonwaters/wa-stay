import type { AccessStatus } from '../../../shared/types/provider.types';
import {
  accessAnnouncement,
  accessStatusText,
  isAccessChipShown,
  POSITION_ANNOUNCE_INTERVAL_MS,
  type AnnouncedAccess,
} from './accessStatus';

const status = (state: AccessStatus['state'], extra: Partial<AccessStatus> = {}): AccessStatus => ({
  providerId: 'parkstay',
  state,
  updatedAt: '2026-10-09T07:00:00.000Z',
  ...extra,
});

describe('accessStatusText', () => {
  it('waiting: provider, position and the wait', () => {
    expect(
      accessStatusText(status('waiting', { position: 123, etaSeconds: 240 }), 'ParkStay')
    ).toBe('ParkStay queue · position 123 · about 4 min');
    expect(accessStatusText(status('waiting', { position: 3, etaSeconds: 7200 }), 'ParkStay')).toBe(
      'ParkStay queue · position 3 · about 2 h'
    );
  });

  it('leaves out a zero position and a missing or zero wait', () => {
    expect(accessStatusText(status('waiting', { position: 0, etaSeconds: 240 }), 'ParkStay')).toBe(
      'ParkStay queue · about 4 min'
    );
    expect(accessStatusText(status('waiting', { position: 12 }), 'ParkStay')).toBe(
      'ParkStay queue · position 12'
    );
    expect(accessStatusText(status('waiting', { etaSeconds: 0 }), 'ParkStay')).toBe(
      'ParkStay queue'
    );
  });

  it('active, expired, error and unknown states', () => {
    expect(accessStatusText(status('active'), 'ParkStay')).toBe('ParkStay · access granted');
    expect(accessStatusText(status('expired'), 'ParkStay')).toBe('ParkStay queue session expired');
    expect(accessStatusText(status('error'), 'ParkStay')).toBe('ParkStay queue status unavailable');
    expect(accessStatusText(status('paused' as AccessStatus['state']), 'ParkStay')).toBe(
      'ParkStay queue status unavailable'
    );
  });

  it('shows no chip while idle or without a gate', () => {
    expect(isAccessChipShown(status('idle'))).toBe(false);
    expect(isAccessChipShown(status('unsupported'))).toBe(false);
    expect(isAccessChipShown(undefined)).toBe(false);
    expect(isAccessChipShown(status('error'))).toBe(true);
  });
});

describe('accessAnnouncement (the throttle)', () => {
  const t0 = 1_000_000;
  const seen = (
    state: AccessStatus['state'],
    position?: number,
    announcedAt: number | null = t0
  ): AnnouncedAccess => ({
    state,
    position,
    announcedAt,
  });

  it('announces every change of state at once: waiting → access granted', () => {
    expect(accessAnnouncement(seen('waiting', 5), status('active'), 'ParkStay', t0 + 1000)).toBe(
      'ParkStay · access granted'
    );
    expect(accessAnnouncement(null, status('waiting', { position: 9 }), 'ParkStay', t0)).toBe(
      'ParkStay queue · position 9'
    );
    expect(accessAnnouncement(seen('active'), status('expired'), 'ParkStay', t0 + 1000)).toBe(
      'ParkStay queue session expired'
    );
  });

  it('announces a new position at most once a minute', () => {
    const next = status('waiting', { position: 100 });
    expect(accessAnnouncement(seen('waiting', 120), next, 'ParkStay', t0 + 59_999)).toBeNull();
    expect(
      accessAnnouncement(seen('waiting', 120), next, 'ParkStay', t0 + POSITION_ANNOUNCE_INTERVAL_MS)
    ).toBe('ParkStay queue · position 100');
    expect(accessAnnouncement(seen('waiting', 120, null), next, 'ParkStay', t0)).toBe(
      'ParkStay queue · position 100'
    );
  });

  it('stays quiet when nothing changed, and when the gate goes idle', () => {
    expect(
      accessAnnouncement(
        seen('waiting', 7, null),
        status('waiting', { position: 7 }),
        'ParkStay',
        t0
      )
    ).toBeNull();
    expect(
      accessAnnouncement(seen('active', undefined, null), status('active'), 'ParkStay', t0)
    ).toBeNull();
    expect(accessAnnouncement(seen('active'), status('idle'), 'ParkStay', t0)).toBeNull();
  });
});
