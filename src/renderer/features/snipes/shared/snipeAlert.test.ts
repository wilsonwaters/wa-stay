/**
 * What an alerted snipe found, in words (R13): the unit, the booking page to open (https only),
 * and the polite announcement.
 */
import { makeAlertedSnipe } from '@tests/fixtures/renderer/snipes';
import { PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import { alertBookingUrl, alertedMessage, alertedUnitLabel } from './snipeAlert';

describe('what an alerted snipe found (R13)', () => {
  it('names the unit as its alert does, else by the place’s name or its id, and none without an alert', () => {
    const snipe = makeAlertedSnipe();
    expect(alertedUnitLabel(snipe, PARKSTAY_MANIFEST)).toBe('CAMPSITE 03');
    const unnamed = makeAlertedSnipe({ alert: { at: new Date(), unitId: '3' } });
    expect(alertedUnitLabel(unnamed, PARKSTAY_MANIFEST)).toBe('Site 3');
    expect(
      alertedUnitLabel(unnamed, PARKSTAY_MANIFEST, { names: new Map([['3', 'Site 3 (shady)']]) })
    ).toBe('Site 3 (shady)');
    expect(
      alertedUnitLabel(
        makeAlertedSnipe({ alert: { at: new Date(), unitId: 'class:117' } }),
        PARKSTAY_MANIFEST
      )
    ).toBe('A site');
    expect(alertedUnitLabel(makeAlertedSnipe({ alert: undefined }), PARKSTAY_MANIFEST)).toBe(
      undefined
    );
  });

  it('opens only an https booking page', () => {
    expect(alertBookingUrl(makeAlertedSnipe())).toMatch(/^https:\/\/parkstay\.dbca\.wa\.gov\.au\//);
    const at = new Date();
    expect(
      alertBookingUrl(makeAlertedSnipe({ alert: { at, unitId: '3', bookingUrl: 'http://x.au/' } }))
    ).toBeUndefined();
    expect(alertBookingUrl(makeAlertedSnipe({ alert: { at, unitId: '3' } }))).toBeUndefined();
    expect(alertBookingUrl(makeAlertedSnipe({ alert: undefined }))).toBeUndefined();
  });

  it('is announced as what is free and where to book it', () => {
    const snipe = makeAlertedSnipe({ name: 'Bungarra trip' });
    expect(alertedMessage(snipe, PARKSTAY_MANIFEST)).toBe(
      'Bungarra trip: CAMPSITE 03 is free. Book on ParkStay.'
    );
    expect(
      alertedMessage(
        makeAlertedSnipe({ name: 'Bungarra trip', alert: undefined }),
        PARKSTAY_MANIFEST
      )
    ).toBe('Bungarra trip: A site is free. Book on ParkStay.');
  });
});
