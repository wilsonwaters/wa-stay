/**
 * Stay Rottnest's manifest against the stakeholder's rules for its automated watch
 * (`ai-state/research/rottnest-terms.md` §9): the person accepts a notice first (§9.1), WA Stay
 * only looks (§9.2: no hold, booking import, waiting room, account or experiment), and slowly
 * (§9.3: watches every 30 minutes at most, one request at a time, 60 s apart).
 */

import { ProviderManifestSchema } from '@shared/types/provider.types';
import { rottnestManifest } from '@main/providers/rottnest';

describe('Stay Rottnest manifest', () => {
  it('is valid', () => {
    expect(ProviderManifestSchema.safeParse(rottnestManifest).success).toBe(true);
  });

  it('only looks: no hold, booking import, waiting room, account or experiment to turn them on', () => {
    expect(rottnestManifest.capabilities).toMatchObject({
      availability: true,
      bulkAvailability: true,
      watches: true,
      holds: false,
      bookingImport: false,
      accessGate: false,
      account: 'none',
    });
    expect(rottnestManifest.experiments).toBeUndefined();
    expect(rottnestManifest.holdRelease).toBeUndefined();
  });

  it('is slow: watches every 30 minutes at most, one request at a time, 60 s apart', () => {
    expect(rottnestManifest.limits).toMatchObject({
      minWatchIntervalMinutes: 30,
      maxConcurrentRequests: 1,
      minRequestIntervalMs: 60_000,
    });
  });

  it('asks the person first, in a notice that gives clause 4, what RIA may do and that the risk is theirs', () => {
    const notice = rottnestManifest.notice!;
    expect(notice.version).toBeGreaterThanOrEqual(1);
    const text = [notice.title, notice.body, ...notice.points].join('\n');
    expect(text).toContain('clause 4, Use of Automated Software');
    expect(text).toContain('made or assisted by automated software');
    expect(text).toContain('cancel the booking without a refund');
    expect(text).toContain('block your internet connection');
    expect(text).toContain('The risk is yours');
    expect(text).toContain('withdraw this');
    expect(notice.confirmLabel).toMatch(/^I understand/);
  });
});
