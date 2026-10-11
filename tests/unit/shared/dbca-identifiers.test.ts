/**
 * @jest-environment node
 *
 * The rename to WA Stay must not touch the identifiers DBCA's ParkStay and queue systems use
 * (B2 non-goals): they name the provider's systems, not this app.
 */
import { APP_NAME } from '@shared/constants';
import {
  PARKSTAY_API_BASE_URL,
  PARKSTAY_BASE_URL,
  QUEUE_API_BASE_URL,
  QUEUE_GROUP,
} from '@main/providers/parkstay/constants';

describe('DBCA identifiers', () => {
  it('keeps the DBCA queue group and the ParkStay URLs', () => {
    expect(QUEUE_GROUP).toBe('parkstayv2');
    expect(PARKSTAY_BASE_URL).toBe('https://parkstay.dbca.wa.gov.au');
    expect(PARKSTAY_API_BASE_URL).toBe('https://parkstay.dbca.wa.gov.au/api');
    expect(QUEUE_API_BASE_URL).toBe('https://queue.dbca.wa.gov.au');
  });

  it('while the app itself is WA Stay', () => {
    expect(APP_NAME).toBe('WA Stay');
  });
});
