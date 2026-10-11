import { useCallback, useEffect, useRef, useState } from 'react';
import { FormProvider, useForm, type Resolver } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { toApiError, useCreateSnipe, useLocationDetail } from '../../../api';
import { SnipeReleaseMode } from '../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { providerToday } from '../../../components/stay/providerToday';
import { ROUTES } from '../../../app/routes';
import { StepFlow, type FlowStep } from '../../../components/StepFlow';
import { unitNoun } from '../../../components/locationFormat';
import { Notice, useToast } from '../../../components/ui';
import { useNow } from '../../../hooks/useNow';
import { releaseModeLabel } from '../shared/snipeFormat';
import { unitNounFor } from '../shared/snipeState';
import { whenInZone } from './releasePreview';
import {
  emptySnipeForm,
  snipeFormSchema,
  stepFields,
  type SnipeFieldName,
  type SnipeFormValues,
  type SnipeStepId,
} from './snipeForm';
import { issueField, suggestedName, toSnipeInput } from './snipeFormMapping';
import { LocationStep } from './steps/LocationStep';
import { ProviderStep } from './steps/ProviderStep';
import { ReleaseStep } from './steps/ReleaseStep';
import { ReviewStep } from './steps/ReviewStep';
import { StayStep } from './steps/StayStep';
import { isComputedMode, useReleasePreview } from './useReleasePreview';
import { zonedInstant } from './zonedTime';

const STEPS: (FlowStep & { id: SnipeStepId })[] = [
  { id: 'provider', title: 'Provider' },
  { id: 'location', title: 'Location' },
  { id: 'stay', title: 'Your stay' },
  { id: 'release', title: 'Release and timing' },
  { id: 'review', title: 'Review' },
];

export interface SnipeFlowProps {
  manifests: readonly ProviderManifest[];
  initialValues: SnipeFormValues;
  initialStep: SnipeStepId;
  /** Why parts of a prefill link were not used. */
  notices?: string[];
}

/** The new-snipe flow: provider → location → stay → release and timing → review (U2). */
export function SnipeFlow({ manifests, initialValues, initialStep, notices = [] }: SnipeFlowProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateSnipe();
  const now = useNow();
  const [step, setStep] = useState<SnipeStepId>(initialStep);
  const [submitError, setSubmitError] = useState<string>();

  const manifestOf = useCallback((id: string) => manifests.find((m) => m.id === id), [manifests]);
  const resolver = useCallback<Resolver<SnipeFormValues>>(
    (values, context, options) => {
      const manifest = manifestOf(values.providerId);
      const at = new Date();
      const schema = snipeFormSchema({ manifest, today: providerToday(manifest, at), now: at });
      return zodResolver(schema)(values, context, options);
    },
    [manifestOf]
  );
  const form = useForm<SnipeFormValues>({
    defaultValues: initialValues,
    resolver,
    mode: 'onTouched',
  });
  const { watch, setValue, getValues, trigger, getFieldState, setError, reset } = form;
  const values = watch();
  const manifest = manifestOf(values.providerId);
  const today = providerToday(manifest, now);
  const noun = values.location?.kind ? unitNoun(values.location.kind) : unitNounFor(manifest);
  const detail = useLocationDetail(
    values.location ? `${values.providerId}:${values.location.externalId}` : null
  );
  const units = detail.isPlaceholderData ? undefined : detail.data?.units;
  const preview = useReleasePreview(
    manifest ?? manifests[0],
    values,
    noun,
    now,
    step === 'review' && Boolean(manifest)
  );

  // Suggest a name from the place and dates until the person writes their own: any name but
  // the last suggestion, or none. Not `dirtyFields.name`: react-hook-form counts any value that
  // differs from its default as dirty, the suggestion included.
  const lastSuggestion = useRef('');
  useEffect(() => {
    if (values.name !== '' && values.name !== lastSuggestion.current) return;
    const next = suggestedName(values.location, values.arrival, values.departure, today);
    lastSuggestion.current = next;
    if (next !== values.name) setValue('name', next);
  }, [values.location, values.arrival, values.departure, values.name, today, setValue]);

  const changeProvider = (id: string) =>
    reset({ ...emptySnipeForm(manifestOf(id)), name: '' }, { keepDefaultValues: true });

  const firstStepWithError = () =>
    STEPS.find(({ id }) => stepFields(id, manifest).some((name) => getFieldState(name).error))?.id;

  const submit = async (): Promise<boolean> => {
    if (!(await trigger())) {
      const failing = firstStepWithError();
      if (failing && failing !== step) setStep(failing);
      return false;
    }
    setSubmitError(undefined);
    try {
      const created = await create.mutateAsync(toSnipeInput(getValues(), manifest));
      toast.success('Snipe created');
      navigate(ROUTES.snipeDetail(created.id));
      return true;
    } catch (error) {
      const apiError = toApiError(error);
      const mode = getValues('releaseMode');
      const fields = (apiError.issues ?? [])
        .map((path) => issueField(path, mode))
        .filter((n): n is SnipeFieldName => Boolean(n));
      if (apiError.code === 'VALIDATION' && fields.length > 0) {
        for (const name of fields) setError(name, { type: 'server', message: apiError.message });
        const failing = firstStepWithError();
        if (failing && failing !== step) setStep(failing);
      } else {
        setSubmitError(apiError.message);
      }
      return false;
    }
  };

  const onContinue = async () =>
    step === 'review' ? submit() : trigger(stepFields(step, manifest));

  const scheduledAt =
    values.releaseMode === SnipeReleaseMode.SCHEDULED && manifest
      ? zonedInstant(values.releaseDate, values.releaseTime, manifest.timezone)
      : undefined;
  const modeLabel = releaseModeLabel(manifest, values.releaseMode);
  const releaseSummary =
    scheduledAt && manifest
      ? `${modeLabel}: ${whenInZone(scheduledAt, manifest.timezone)}`
      : isComputedMode(values.releaseMode)
        ? `${modeLabel}. ${preview}`
        : modeLabel;

  return (
    <FormProvider {...form}>
      <form noValidate onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-6">
        {notices.length > 0 && (
          <Notice tone="info" title="Some of the link couldn't be used">
            <ul className="list-disc pl-5">
              {notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          </Notice>
        )}
        <StepFlow
          label="New snipe steps"
          steps={STEPS}
          current={step}
          onStepChange={(id) => setStep(id as SnipeStepId)}
          onContinue={onContinue}
          finalLabel="Create snipe"
          finishing={create.isPending}
        >
          {step === 'provider' && <ProviderStep onProviderChange={changeProvider} />}
          {step !== 'provider' && !manifest && (
            <Notice tone="warning">Choose a provider first.</Notice>
          )}
          {step === 'location' && manifest && (
            <LocationStep manifest={manifest} place={detail.data} placeLoading={detail.isLoading} />
          )}
          {step === 'stay' && manifest && (
            <StayStep manifest={manifest} today={today} units={units} noun={noun} />
          )}
          {step === 'release' && manifest && (
            <ReleaseStep
              manifest={manifest}
              noun={noun}
              releaseInfo={detail.data?.releaseInfo}
              now={now}
            />
          )}
          {step === 'review' && manifest && (
            <ReviewStep
              manifest={manifest}
              today={today}
              noun={noun}
              place={detail.data}
              placeLoading={detail.isLoading}
              releaseSummary={releaseSummary}
              onChangeStep={setStep}
              submitError={submitError}
            />
          )}
        </StepFlow>
      </form>
    </FormProvider>
  );
}

export default SnipeFlow;
