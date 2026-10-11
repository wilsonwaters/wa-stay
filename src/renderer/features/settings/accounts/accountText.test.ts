import {
  FAKESTAY,
  LAST_SIGN_IN,
  OPENSTAY,
  PARKSTAY,
  account,
} from '@tests/fixtures/renderer/settings';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { formatDay } from '../format';
import { accountPurpose, accountRowText, missingAccountWarning } from './accountText';

const withAccount = (
  manifest: ProviderManifest,
  capabilities: Partial<ProviderManifest['capabilities']>
): ProviderManifest => ({
  ...manifest,
  capabilities: { ...manifest.capabilities, ...capabilities },
});

describe('accountRowText', () => {
  it('signed in: "Signed in as" the name, else the email, with Sign out', () => {
    expect(
      accountRowText(
        PARKSTAY,
        account({ status: 'signed-in', displayName: 'Ann Lee', email: 'a@x.au' })
      )
    ).toMatchObject({ status: 'Signed in as Ann Lee', tone: 'signed-in', action: 'sign-out' });
    expect(
      accountRowText(PARKSTAY, account({ status: 'signed-in', email: 'a@x.au' }))
    ).toMatchObject({
      status: 'Signed in as a@x.au',
    });
    expect(accountRowText(PARKSTAY, account({ status: 'signed-in' })).status).toBe('Signed in');
  });

  it('signed in before: "Signed out" with Reconnect (main cannot tell expiry from sign-out)', () => {
    const text = accountRowText(
      PARKSTAY,
      account({ status: 'signed-out', email: 'a@x.au', lastSignedInAt: LAST_SIGN_IN })
    );
    expect(text).toEqual({
      status: 'Signed out',
      tone: 'neutral',
      action: 'reconnect',
      meta: 'a@x.au · last signed in Sat 3 Oct 2026',
    });
  });

  it('never signed in, or no account row at all: "Not connected" with Connect', () => {
    for (const stored of [undefined, account(), account({ status: 'signed-out' })]) {
      expect(accountRowText(PARKSTAY, stored)).toMatchObject({
        status: 'Not connected',
        action: 'connect',
      });
    }
  });

  it('a provider that needs an account takes the warning tone while not signed in', () => {
    expect(accountRowText(FAKESTAY, undefined).tone).toBe('warning');
    expect(accountRowText(FAKESTAY, account({ status: 'signed-in' })).tone).toBe('signed-in');
  });

  it('no accounts: "No account needed" and no action', () => {
    expect(accountRowText(OPENSTAY, undefined)).toEqual({
      status: 'No account needed',
      tone: 'neutral',
      action: null,
    });
  });
});

describe('accountPurpose ("Needed for")', () => {
  it.each<[string, Partial<ProviderManifest['capabilities']>, string | null]>([
    // The status line already says "No account needed": no second line says it again.
    ['none', { account: 'none' }, null],
    ['none, with booking import', { account: 'none', bookingImport: true }, null],
    [
      'optional, with Site Sniper and holds (ParkStay: the soft hint, §12.32)',
      { account: 'optional', holds: true, snipes: true, bookingImport: false },
      'Optional. Connect ParkStay before a release so checkout is quicker. Holds work without it.',
    ],
    [
      'optional, with holds but no Site Sniper: checkout only, no release',
      { account: 'optional', holds: true, snipes: false, bookingImport: false },
      'Optional. Connect ParkStay so checkout is quicker. Holds work without it.',
    ],
    [
      'optional, no holds',
      { account: 'optional', holds: false, snipes: false, bookingImport: false },
      'Optional.',
    ],
    [
      'required for holds, with Site Sniper and automatic holds (watches)',
      { account: 'required-for-holds', bookingImport: false },
      'Needed for holds (Site Sniper and automatic holds).',
    ],
    [
      'required for holds, Site Sniper but no watches',
      { account: 'required-for-holds', watches: false, bookingImport: false },
      'Needed for holds (Site Sniper).',
    ],
    [
      'required for holds, automatic holds but no Site Sniper',
      { account: 'required-for-holds', snipes: false, bookingImport: false },
      'Needed for automatic holds.',
    ],
    [
      'required for holds, neither Site Sniper nor watches',
      { account: 'required-for-holds', snipes: false, watches: false, bookingImport: false },
      'Needed for holds.',
    ],
    [
      'required',
      { account: 'required', bookingImport: false },
      'Needed for everything WA Stay does on ParkStay.',
    ],
    [
      'required for holds, with booking import',
      { account: 'required-for-holds', bookingImport: true },
      'Needed for holds (Site Sniper and automatic holds). Also used to import your bookings.',
    ],
    [
      'optional, with booking import',
      { account: 'optional', holds: false, snipes: false, bookingImport: true },
      'Optional. Also used to import your bookings.',
    ],
  ])('%s', (_case, capabilities, expected) => {
    expect(accountPurpose(withAccount(PARKSTAY, capabilities))).toBe(expected);
  });
});

describe('accountPurpose when signed in', () => {
  it('an optional account no longer asks to connect; it says what being signed in gives', () => {
    expect(accountPurpose(PARKSTAY, account({ status: 'signed-in' }))).toBe(
      "Optional. Checkout is quicker while you're signed in."
    );
    // Signed out, or not yet answered: the soft suggestion (§12.32)
    for (const stored of [undefined, account(), account({ status: 'signed-out' })]) {
      expect(accountPurpose(PARKSTAY, stored)).toMatch(
        /^Optional\. Connect ParkStay before a release/
      );
    }
    // With holds but no Site Sniper, the same once signed in
    expect(
      accountPurpose(withAccount(PARKSTAY, { snipes: false }), account({ status: 'signed-in' }))
    ).toBe("Optional. Checkout is quicker while you're signed in.");
    // A required account reads the same either way
    expect(accountPurpose(FAKESTAY, account({ status: 'signed-in' }))).toBe(
      accountPurpose(FAKESTAY, undefined)
    );
  });
});

describe('missingAccountWarning', () => {
  it('only for a provider that needs the account, while not signed in', () => {
    expect(missingAccountWarning(PARKSTAY, undefined)).toBeNull();
    expect(missingAccountWarning(FAKESTAY, undefined)).toBe(
      "FakeStay holds can't be placed until you connect."
    );
    expect(missingAccountWarning(FAKESTAY, account({ status: 'signed-in' }))).toBeNull();
    expect(missingAccountWarning(withAccount(FAKESTAY, { account: 'required' }), undefined)).toBe(
      "FakeStay can't be used until you connect."
    );
  });
});

describe('formatDay', () => {
  it('reads "Fri 3 Oct 2026" in the computer’s time zone, from a string or a Date', () => {
    expect(formatDay('2026-10-02T23:00:00')).toBe('Fri 2 Oct 2026');
    expect(formatDay(new Date(2026, 9, 3, 12))).toBe('Sat 3 Oct 2026');
    expect(formatDay('not a date')).toBe('');
  });
});
