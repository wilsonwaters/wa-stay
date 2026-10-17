/**
 * The words for details saved in the app (`credentials`), as R16 settles them: an optional
 * account of saved details is added, never connected; one detail is "it" and several are
 * "them"; a copy is announced by the detail's label.
 */
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import {
  KEY_SAVED,
  KEYSTAY,
  MEMBER_NUMBER_FIELD,
  keyAccount,
} from '@tests/fixtures/renderer/settings';
import {
  accountPurpose,
  credentialCopiedAnnouncement,
  credentialsStorageText,
  removeCredentialsMessage,
} from './accountText';

const PASSWORD_FIELD = { key: 'password', label: 'Password', secret: true };
const several = keyAccount({ fields: [MEMBER_NUMBER_FIELD, PASSWORD_FIELD] });

const withCapabilities = (
  capabilities: Partial<ProviderManifest['capabilities']>
): ProviderManifest => ({ ...KEYSTAY, capabilities: { ...KEYSTAY.capabilities, ...capabilities } });

describe('credentials words (R16)', () => {
  it('one detail is "it", several are "them": the form and Remove say so', () => {
    expect(removeCredentialsMessage(KEY_SAVED)).toBe(
      'WA Stay forgets it; you can add it again any time.'
    );
    expect(credentialsStorageText(KEY_SAVED)).toBe(
      'Kept encrypted on this computer. WA Stay never shows it again.'
    );
    expect(removeCredentialsMessage(several)).toBe(
      'WA Stay forgets them; you can add them again any time.'
    );
    expect(credentialsStorageText(several)).toBe(
      'Kept encrypted on this computer. WA Stay never shows them again.'
    );
  });

  it('a copy is announced by the label, at the start of a sentence', () => {
    expect(credentialCopiedAnnouncement(MEMBER_NUMBER_FIELD)).toBe('Member number copied');
    expect(credentialCopiedAnnouncement({ label: 'RAC member number' })).toBe(
      'RAC member number copied'
    );
    expect(credentialCopiedAnnouncement({ label: 'member number' })).toBe('Member number copied');
  });

  it('an optional account of saved details is added, never connected', () => {
    const withHolds = withCapabilities({ holds: true, snipes: true });
    expect(accountPurpose(withHolds, keyAccount())).toBe(
      'Optional. Add your member number before a release if you have one. Holds work without it.'
    );
    expect(accountPurpose(withCapabilities({ holds: true }), keyAccount())).toBe(
      'Optional. Add your member number if you have one. Holds work without it.'
    );
    expect(accountPurpose(withHolds, keyAccount({ fields: several.fields }))).toBe(
      'Optional. Add your details before a release if you have them. Holds work without it.'
    );
    // Saved, or a provider with no holds: nothing to suggest
    expect(accountPurpose(withHolds, KEY_SAVED)).toBe('Optional.');
    expect(accountPurpose(KEYSTAY, keyAccount())).toBe('Optional.');
    for (const account of [keyAccount(), KEY_SAVED]) {
      expect(accountPurpose(withHolds, account)).not.toMatch(/Connect|signed in/);
    }
  });
});
