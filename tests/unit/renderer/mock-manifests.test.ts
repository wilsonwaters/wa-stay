import { parkstayManifest } from '@main/providers/parkstay';
import { ProviderManifestSchema } from '@shared/types/provider.types';
import { ACCOUNT_REQUIRED_MANIFEST } from '@tests/fixtures/renderer/snipes';
import {
  BROWSE_ONLY_MANIFEST,
  FAKE_MANIFEST,
  PARKSTAY_MANIFEST,
} from '@tests/utils/renderer/manifests';

describe('renderer test manifests', () => {
  it('give ParkStay the stay fields, release modes, capabilities, limits and time zone main registers', () => {
    expect(PARKSTAY_MANIFEST.stayFields).toEqual(parkstayManifest.stayFields);
    expect(PARKSTAY_MANIFEST.releaseModes).toEqual(parkstayManifest.releaseModes);
    expect(PARKSTAY_MANIFEST.capabilities.snipes).toBe(parkstayManifest.capabilities.snipes);
    expect(PARKSTAY_MANIFEST.capabilities.accessGate).toBe(
      parkstayManifest.capabilities.accessGate
    );
    expect(PARKSTAY_MANIFEST.capabilities.holds).toBe(parkstayManifest.capabilities.holds);
    expect(PARKSTAY_MANIFEST.capabilities.watches).toBe(parkstayManifest.capabilities.watches);
    expect(PARKSTAY_MANIFEST.capabilities.account).toBe(parkstayManifest.capabilities.account);
    expect(PARKSTAY_MANIFEST.capabilities.bookingImport).toBe(
      parkstayManifest.capabilities.bookingImport
    );
    expect(PARKSTAY_MANIFEST.capabilities.catalog).toBe(parkstayManifest.capabilities.catalog);
    expect(PARKSTAY_MANIFEST.website).toBe(parkstayManifest.website);
    expect(PARKSTAY_MANIFEST.limits).toEqual(parkstayManifest.limits);
    expect(PARKSTAY_MANIFEST.timezone).toBe(parkstayManifest.timezone);
    expect(PARKSTAY_MANIFEST.currency).toBe(parkstayManifest.currency);
    expect(PARKSTAY_MANIFEST.bulkAvailabilityStayFields).toEqual(
      parkstayManifest.bulkAvailabilityStayFields
    );
  });

  it('are all valid manifests', () => {
    for (const manifest of [
      PARKSTAY_MANIFEST,
      FAKE_MANIFEST,
      BROWSE_ONLY_MANIFEST,
      ACCOUNT_REQUIRED_MANIFEST,
    ]) {
      expect(ProviderManifestSchema.safeParse(manifest).success).toBe(true);
    }
  });
});
