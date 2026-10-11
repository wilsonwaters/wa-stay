/**
 * Fixtures for the Settings tests (U4): a second provider that needs an account for holds, one
 * with no accounts at all, ParkStay accounts in each state, an email notifier view, and a
 * reader for the app's polite announcer.
 */
import { NotifierChannel, NotifierStatus, SMTPPreset } from '../../../src/shared/types';
import type { EmailNotifierView } from '../../../src/renderer/api';
import type { ProviderAccount, ProviderManifest } from '../../../src/shared/types/provider.types';
import { PARKSTAY_MANIFEST } from '../../utils/renderer/createMockApi';

export const PARKSTAY = {
  ...PARKSTAY_MANIFEST,
  capabilities: { ...PARKSTAY_MANIFEST.capabilities, bookingImport: false },
} as unknown as ProviderManifest;

/** A provider whose holds need you signed in (FakeProvider's `required-for-holds`). */
export const FAKESTAY = {
  ...PARKSTAY_MANIFEST,
  id: 'fakestay',
  name: 'Fake Stay',
  shortName: 'FakeStay',
  brand: { color: '#5A3E8C', monogram: 'FS' }, // token-guard-ignore: provider brand data
  capabilities: {
    ...PARKSTAY_MANIFEST.capabilities,
    accessGate: false,
    bookingImport: true,
    account: 'required-for-holds',
  },
} as unknown as ProviderManifest;

/** A provider with holds (automatic holds on watches) and an optional account, but no Site Sniper. */
export const HOLDSTAY = {
  ...PARKSTAY_MANIFEST,
  id: 'holdstay',
  name: 'Hold Stay',
  shortName: 'HoldStay',
  brand: { color: '#1F5A7A', monogram: 'HS' }, // token-guard-ignore: provider brand data
  capabilities: {
    ...PARKSTAY_MANIFEST.capabilities,
    snipes: false,
    accessGate: false,
    bookingImport: false,
    account: 'optional',
  },
  releaseModes: [],
} as unknown as ProviderManifest;

/** A provider with watches and an optional account, but no holds. */
export const WATCHSTAY = {
  ...PARKSTAY_MANIFEST,
  id: 'watchstay',
  name: 'Watch Stay',
  shortName: 'WatchStay',
  brand: { color: '#2E6B3A', monogram: 'WS' }, // token-guard-ignore: provider brand data
  capabilities: {
    ...PARKSTAY_MANIFEST.capabilities,
    holds: false,
    snipes: false,
    accessGate: false,
    bookingImport: false,
    account: 'optional',
  },
  releaseModes: [],
} as unknown as ProviderManifest;

/** A browse-only provider with no accounts. */
export const OPENSTAY = {
  ...PARKSTAY_MANIFEST,
  id: 'openstay',
  name: 'Open Stay',
  shortName: 'OpenStay',
  brand: { color: '#2D60A0', monogram: 'OS' }, // token-guard-ignore: provider brand data
  capabilities: {
    ...PARKSTAY_MANIFEST.capabilities,
    holds: false,
    snipes: false,
    bookingImport: false,
    accessGate: false,
    account: 'none',
  },
} as unknown as ProviderManifest;

/** Noon on Sat 3 Oct 2026 in the computer's time zone, so it reads "Sat 3 Oct 2026" anywhere. */
export const LAST_SIGN_IN = new Date(2026, 9, 3, 12).toISOString();

export function account(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return { providerId: 'parkstay', requirement: 'optional', status: 'unknown', ...overrides };
}

export const SIGNED_IN = account({
  status: 'signed-in',
  email: 'ann@example.com',
  lastSignedInAt: LAST_SIGN_IN,
});

export const SIGNED_OUT_BEFORE = account({
  status: 'signed-out',
  email: 'ann@example.com',
  lastSignedInAt: LAST_SIGN_IN,
});

/** The stored email notifier: Gmail, a password stored (never sent here), on. */
export function emailNotifier(overrides: Partial<EmailNotifierView> = {}): EmailNotifierView {
  return {
    id: 1,
    channel: NotifierChannel.EMAIL_SMTP,
    displayName: 'Email',
    enabled: true,
    config: {
      preset: SMTPPreset.GMAIL,
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: 'ann@example.com' },
    },
    secretState: 'ok',
    status: NotifierStatus.CONFIGURED,
    hasPassword: true,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

/** What the app's polite announcer last said, without its repeat marker. */
export function politeAnnouncement(): string {
  const region = document.querySelector('[aria-live="polite"][aria-atomic="true"]');
  return (region?.textContent ?? '').replace(/\u00A0/g, '').trim();
}
