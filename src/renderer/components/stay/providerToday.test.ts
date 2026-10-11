import { FAKE_MANIFEST, PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import { providerToday } from './providerToday';

describe('providerToday', () => {
  it('uses the provider’s time zone for today', () => {
    const at = new Date('2099-12-01T17:00:00Z'); // 1 am on the 2nd in Perth
    expect(providerToday(PARKSTAY_MANIFEST, at)).toBe('2099-12-02');
    expect(providerToday({ ...FAKE_MANIFEST, timezone: 'America/Los_Angeles' }, at)).toBe(
      '2099-12-01'
    );
  });

  it('falls back to this computer’s zone for a provider that is not installed', () => {
    const at = new Date('2099-12-01T12:00:00Z');
    expect(providerToday(undefined, at)).toMatch(/^2099-12-0[12]$/);
  });
});
