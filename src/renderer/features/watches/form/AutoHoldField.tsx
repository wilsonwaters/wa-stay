import { Link } from 'react-router';
import { useFormContext } from 'react-hook-form';
import { useAccountStatus } from '../../../api';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { ROUTES } from '../../../app/routes';
import { ProviderStayFields } from '../../../components/stay/ProviderStayFields';
import type { UnitNoun } from '../../../components/stay/UnitPicker';
import { Checkbox, Notice } from '../../../components/ui';
import { useSetWatchField } from './useSetWatchField';
import { watchStayFields, type WatchFormValues } from './watchFormSchema';

export interface AutoHoldFieldProps {
  manifest: ProviderManifest;
  noun: UnitNoun;
}

/**
 * "Hold a site automatically when found" (architecture-notes §12.4), only for providers with
 * holds. Ticking it asks for the provider's hold fields. Signing in is a suggestion for
 * providers whose account is optional, and a warning for those that need one (§12.32).
 */
export function AutoHoldField({ manifest, noun }: AutoHoldFieldProps) {
  const { register, watch, formState } = useFormContext<WatchFormValues>();
  const set = useSetWatchField();
  const account = useAccountStatus(manifest.id);
  const autoHold = watch('autoHold');
  const stayParams = watch('stayParams');
  const holdFields = watchStayFields(manifest).hold;
  const errors = formState.errors.stayParams ?? {};
  const signedIn = account.data?.status === 'signed-in';
  const requirement = manifest.capabilities.account;
  const settings = ROUTES.settings('accounts', { provider: manifest.id });

  return (
    <div className="flex flex-col gap-4">
      <Checkbox
        label={`Hold a ${noun.one} automatically when found`}
        description={`When a ${noun.one} is free for your whole stay, WA Stay places a temporary hold on it. You pay for it on ${manifest.shortName} before the hold runs out.`}
        {...register('autoHold')}
      />
      {autoHold && holdFields.length > 0 && (
        <div className="flex flex-col gap-4 border-l-2 border-border pl-4">
          <ProviderStayFields
            fields={holdFields}
            values={stayParams}
            onChange={(key, value) => set(`stayParams.${key}`, value)}
            errors={Object.fromEntries(
              holdFields.map((field) => [field.key, errors[field.key]?.message])
            )}
          />
        </div>
      )}
      {!signedIn && requirement === 'optional' && (
        <p className="text-sm text-fg-muted">
          Optional:{' '}
          <Link to={settings} className="font-semibold text-brand-strong hover:underline">
            connect {manifest.shortName} in Settings
          </Link>{' '}
          so checkout is quicker.
        </p>
      )}
      {!signedIn && (requirement === 'required-for-holds' || requirement === 'required') && (
        <Notice
          tone="warning"
          actions={
            <Link to={settings} className="font-semibold text-brand-strong hover:underline">
              Connect {manifest.shortName}
            </Link>
          }
        >
          {manifest.shortName} needs you signed in to hold a {noun.one}.
        </Notice>
      )}
    </div>
  );
}

export default AutoHoldField;
