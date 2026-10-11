import { useState, type FormEvent } from 'react';
import { ApiError, useOpenSignInLink } from '../../../api';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { Button, Field, TextField, useAnnounce } from '../../../components/ui';

/** What the renderer checks before main does: an https link (main checks it is the provider's). */
export function signInLinkError(value: string): string | null {
  const text = value.trim();
  if (!text) return 'Paste the link from the email';
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return 'Paste the whole link, starting with https://';
  }
  return url.protocol === 'https:' ? null : 'Paste the whole link, starting with https://';
}

/**
 * The fallback for a sign-in link that arrived by email and opened in the browser: paste it,
 * and it opens in WA Stay's sign-in window instead (`accounts.openSignInLink`). Main refuses a
 * link that isn't one of the provider's sign-in links; that message shows on the field.
 */
export function SignInLinkField({ manifest }: { manifest: ProviderManifest }) {
  const openLink = useOpenSignInLink();
  const announce = useAnnounce();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const invalid = signInLinkError(value);
    setError(invalid);
    if (invalid) return;
    try {
      await openLink.mutateAsync({ providerId: manifest.id, url: value.trim() });
      setValue('');
      openLink.reset();
      announce('Sign-in link opened');
    } catch (thrown) {
      setError(thrown instanceof ApiError || thrown instanceof Error ? thrown.message : null);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm text-fg-secondary">
        If {manifest.shortName} emailed you a sign-in link, copy it and paste it here. It opens in
        WA Stay&apos;s sign-in window.
      </p>
      <Field label="Sign-in link" error={error ?? undefined}>
        <TextField
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </Field>
      <div>
        <Button type="submit" variant="secondary" size="sm" loading={openLink.isPending}>
          Open link
        </Button>
      </div>
    </form>
  );
}

export default SignInLinkField;
