import { useMemo, useRef, useState } from 'react';
import { FormProvider, useForm, type Resolver } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  toApiError,
  useLocationDetail,
  useProviders,
  useUpdateWatch,
  useWatch,
  useWatchUpdates,
} from '../../../api';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { Watch } from '../../../../shared/types/watch.types';
import { ROUTES } from '../../../app/routes';
import { LocationCombobox } from '../../../components/LocationCombobox';
import {
  Button,
  Field,
  Notice,
  PageHeader,
  ProviderBadge,
  Skeleton,
  TextField,
  Textarea,
  useToast,
} from '../../../components/ui';
import { issueField } from '../create/issueField';
import { WatchAlertFields } from '../form/WatchAlertFields';
import { WatchStayFields } from '../form/WatchStayFields';
import { fromWatch, toWatchUpdate } from '../form/watchFormMapping';
import { watchFormSchema, type WatchFormValues } from '../form/watchFormSchema';
import { DeleteWatchDialog } from '../shared/DeleteWatchDialog';
import { useWatchActions } from '../shared/useWatchActions';
import { unitNounFor } from '../shared/watchState';
import { providerToday } from '../../../components/stay/providerToday';

const PAGE = 'mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8 lg:px-8';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-5">
      <h2 className="text-xl font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}

function EditWatchForm({ watch, manifest }: { watch: Watch; manifest: ProviderManifest }) {
  const navigate = useNavigate();
  const toast = useToast();
  const update = useUpdateWatch();
  const actions = useWatchActions(watch, manifest);
  const [confirming, setConfirming] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const formRef = useRef<HTMLFormElement>(null);
  // The starting values are fixed when the page opens; later refetches do not reset typing.
  const [{ values: initial, notes }] = useState(() => fromWatch(watch, manifest));
  const today = providerToday(manifest, new Date());
  const resolver = useMemo<Resolver<WatchFormValues>>(
    () =>
      zodResolver(
        watchFormSchema({
          manifest,
          today,
          keepArrival: watch.stay.arrival,
          keepInterval: watch.checkIntervalMinutes,
        })
      ),
    [manifest, today, watch.stay.arrival, watch.checkIntervalMinutes]
  );
  const form = useForm<WatchFormValues>({ defaultValues: initial, resolver, mode: 'onTouched' });
  const { handleSubmit, register, watch: value, setValue, setError, formState } = form;
  const detail = ROUTES.watchDetail(watch.id);
  const location = value('location');
  const place = useLocationDetail(location ? `${manifest.id}:${location.externalId}` : null);
  const units = place.isPlaceholderData ? undefined : place.data?.units;
  const focusFirstInvalid = () =>
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    );

  const save = handleSubmit(async (values) => {
    setSaveError(undefined);
    const updates = toWatchUpdate(values, initial, watch, manifest);
    try {
      if (Object.keys(updates).length > 0) await update.mutateAsync({ id: watch.id, updates });
      toast.success('Watch saved');
      navigate(detail);
    } catch (error) {
      const apiError = toApiError(error);
      const fields = (apiError.issues ?? []).map(issueField).filter(Boolean);
      if (apiError.code === 'VALIDATION' && fields.length) {
        fields.forEach(
          (name) => name && setError(name, { type: 'server', message: apiError.message })
        );
        focusFirstInvalid();
      } else setSaveError(apiError.message);
    }
  }, focusFirstInvalid);

  return (
    <FormProvider {...form}>
      <form ref={formRef} noValidate onSubmit={save} className={PAGE}>
        <PageHeader title={`Edit ${watch.name}`} back={{ label: watch.name, href: `#${detail}` }} />
        <Section title="Provider">
          <div className="flex items-center gap-3">
            <ProviderBadge providerId={manifest.id} />
            <p className="text-sm text-fg-secondary">A watch stays with its provider.</p>
          </div>
        </Section>
        <Section title="Location">
          <LocationCombobox
            providerId={manifest.id}
            providerName={manifest.shortName}
            value={value('location')}
            onChange={(next) => setValue('location', next, { shouldDirty: true })}
            error={formState.errors.location?.message}
          />
        </Section>
        <Section title="Your stay">
          <WatchStayFields
            manifest={manifest}
            today={today}
            units={units}
            noun={unitNounFor(manifest)}
            fieldNotes={notes}
          />
        </Section>
        <Section title="Alerts">
          <WatchAlertFields
            manifest={manifest}
            noun={unitNounFor(manifest)}
            keepInterval={watch.checkIntervalMinutes}
          />
        </Section>
        <Section title="Name and notes">
          <Field label="Name" error={formState.errors.name?.message}>
            <TextField autoComplete="off" {...register('name')} />
          </Field>
          <Field label="Notes" optional error={formState.errors.notes?.message}>
            <Textarea rows={3} {...register('notes')} />
          </Field>
        </Section>
        {saveError && (
          <Notice tone="danger" title="Changes couldn't be saved">
            {saveError}
          </Notice>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete watch
          </Button>
          <div className="flex gap-3">
            <Button as="a" href={`#${detail}`} variant="ghost">
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={update.isPending}>
              Save changes
            </Button>
          </div>
        </div>
        <DeleteWatchDialog
          watch={watch}
          open={confirming}
          onConfirm={async () => {
            await actions.deleteWatch();
            navigate(ROUTES.watches());
          }}
          onCancel={() => setConfirming(false)}
        />
      </form>
    </FormProvider>
  );
}

/** `/watches/:id/edit`: the create flow's fields on one page; the provider cannot change. */
export function EditWatchPage() {
  useWatchUpdates();
  const { id } = useParams();
  const query = useWatch(Number(id));
  const providers = useProviders();
  const manifest = providers.data?.find((m) => m.id === query.data?.providerId);
  const back = { label: 'Watches', href: `#${ROUTES.watches()}` };

  if (query.isPending || (query.data && providers.isPending)) {
    return (
      <div className={PAGE} aria-busy="true">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }
  if (!query.data) {
    const notFound = query.data === null || toApiError(query.error).code === 'NOT_FOUND';
    return (
      <div className={PAGE}>
        <PageHeader
          title={notFound ? 'Watch not found' : "This watch couldn't be loaded"}
          back={back}
        />
        {!notFound && query.error && <Notice tone="danger">{query.error.message}</Notice>}
      </div>
    );
  }
  if (!manifest) {
    return (
      <div className={PAGE}>
        <PageHeader title={`Edit ${query.data.name}`} back={back} />
        <Notice tone="warning" title="This watch's provider isn't available">
          {"Its details can't be changed. You can still delete it from the watch's page."}
        </Notice>
      </div>
    );
  }
  return <EditWatchForm watch={query.data} manifest={manifest} />;
}

export default EditWatchPage;
