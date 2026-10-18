import { useId } from 'react';
import { Link } from 'react-router';
import { useFormContext } from 'react-hook-form';
import { CircleAlert } from 'lucide-react';
import { useAccountStatus } from '../../../api';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { ROUTES } from '../../../app/routes';
import { inSentence } from '../../../components/accounts/credentialText';
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
 * providers whose account is optional ("add your {label}" for details saved in the app, such as
 * RAC's member number, which has no sign-in), and a warning for those that need one (§12.32). At a
 * place with more than one stay type it needs a stay type or a unit chosen: the schema's
 * error shows under the box, which it describes.
 */
export function AutoHoldField({ manifest, noun }: AutoHoldFieldProps) {
  const { register, watch, formState, trigger } = useFormContext<WatchFormValues>();
  const set = useSetWatchField();
  const account = useAccountStatus(manifest.id);
  const autoHold = watch('autoHold');
  const stayParams = watch('stayParams');
  const holdFields = watchStayFields(manifest).hold;
  const errors = formState.errors.stayParams ?? {};
  const holdError = formState.errors.autoHold?.message;
  const holdErrorId = `${useId()}-error`;
  const signedIn = account.data?.status === 'signed-in';
  const requirement = manifest.capabilities.account;
  const settings = ROUTES.settings('accounts', { provider: manifest.id });
  // Details saved in the app (a member number) are added, never connected
  const detailFields = account.data?.fields ?? [];
  const savedDetails =
    account.data?.authKind !== 'credentials'
      ? undefined
      : detailFields.length === 1
        ? inSentence(detailFields[0].label)
        : 'details';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Checkbox
          label={`Hold a ${noun.one} automatically when found`}
          description={`When a ${noun.one} is free for your whole stay, WA Stay places a temporary hold on it. You pay for it on ${manifest.shortName} before the hold runs out.`}
          aria-invalid={holdError ? true : undefined}
          aria-describedby={holdError ? holdErrorId : undefined}
          {...register('autoHold', {
            // The stay-type rule is checked as the box is ticked, not when it loses focus: an
            // error appearing on blur would move Continue from under the pointer mid-click.
            onChange: () => void trigger('autoHold'),
          })}
        />
        {holdError && (
          <p id={holdErrorId} className="flex items-start gap-1.5 text-sm font-medium text-danger">
            <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{holdError}</span>
          </p>
        )}
      </div>
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
      {!signedIn && requirement === 'optional' && savedDetails !== undefined && (
        <p className="text-sm text-fg-muted">
          Optional:{' '}
          <Link to={settings} className="font-semibold text-brand-strong hover:underline">
            add your {savedDetails} in Settings
          </Link>
          .
        </p>
      )}
      {!signedIn && requirement === 'optional' && savedDetails === undefined && (
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
