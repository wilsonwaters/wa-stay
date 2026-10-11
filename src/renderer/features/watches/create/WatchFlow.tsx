import { useCallback, useEffect, useRef, useState } from 'react';
import { FormProvider, useForm, type Resolver } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { toApiError, useCreateWatch, useLocationDetail } from '../../../api';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { ROUTES } from '../../../app/routes';
import { StepFlow, type FlowStep } from '../../../components/StepFlow';
import { stayFieldDefaults } from '../../../components/stay/stayFields';
import { unitNoun } from '../../../components/locationFormat';
import { Notice, useToast } from '../../../components/ui';
import { useNow } from '../../../hooks/useNow';
import { suggestedName, toWatchInput } from '../form/watchFormMapping';
import {
  defaultInterval,
  stepFields,
  watchFormSchema,
  watchStayFields,
  type WatchFieldName,
  type WatchFormValues,
} from '../form/watchFormSchema';
import { unitNounFor } from '../shared/watchState';
import { issueField } from './issueField';
import { AlertsStep } from './steps/AlertsStep';
import { LocationStep } from './steps/LocationStep';
import { ProviderStep } from './steps/ProviderStep';
import { ReviewStep, type FlowStepId } from './steps/ReviewStep';
import { StayStep } from './steps/StayStep';
import { providerToday } from '../../../components/stay/providerToday';

const STEPS: (FlowStep & { id: FlowStepId })[] = [
  { id: 'provider', title: 'Provider' },
  { id: 'location', title: 'Location' },
  { id: 'stay', title: 'Your stay' },
  { id: 'alerts', title: 'Alerts' },
  { id: 'review', title: 'Review' },
];

export interface WatchFlowProps {
  manifests: readonly ProviderManifest[];
  initialValues: WatchFormValues;
  initialStep: FlowStepId;
  /** Why parts of a prefill link were not used. */
  notices?: string[];
}

/** The create-watch flow: provider → location → stay → alerts → review (U1 design §2). */
export function WatchFlow({ manifests, initialValues, initialStep, notices = [] }: WatchFlowProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateWatch();
  const now = useNow();
  const [step, setStep] = useState<FlowStepId>(initialStep);
  const [submitError, setSubmitError] = useState<string>();

  const manifestOf = useCallback((id: string) => manifests.find((m) => m.id === id), [manifests]);
  const resolver = useCallback<Resolver<WatchFormValues>>(
    (values, context, options) => {
      const manifest = manifestOf(values.providerId);
      const today = providerToday(manifest, new Date());
      return zodResolver(watchFormSchema({ manifest, today }))(values, context, options);
    },
    [manifestOf]
  );
  const form = useForm<WatchFormValues>({
    defaultValues: initialValues,
    resolver,
    mode: 'onTouched',
  });
  const { watch, setValue, getValues, trigger, getFieldState, setError } = form;

  const [providerId, location, arrival, departure, autoHold] = watch([
    'providerId',
    'location',
    'arrival',
    'departure',
    'autoHold',
  ]);
  const manifest = manifestOf(providerId);
  const today = providerToday(manifest, now);
  const noun = location?.kind ? unitNoun(location.kind) : unitNounFor(manifest);
  // The place's units, for the unit choice (a search result has none until the detail loads).
  const detail = useLocationDetail(location ? `${providerId}:${location.externalId}` : null);
  const units = detail.isPlaceholderData ? undefined : detail.data?.units;

  // Suggest a name from the place and dates until the person writes their own: any name but
  // the last suggestion, or none. Not `dirtyFields.name`: react-hook-form counts any value that
  // differs from its default as dirty, the suggestion included.
  const name = watch('name');
  const lastSuggestion = useRef('');
  useEffect(() => {
    if (name !== '' && name !== lastSuggestion.current) return;
    const next = suggestedName(location, arrival, departure, today);
    lastSuggestion.current = next;
    if (next !== name) setValue('name', next);
  }, [location, arrival, departure, today, name, setValue]);

  const changeProvider = (id: string) => {
    const next = manifestOf(id);
    const fields = watchStayFields(next);
    setValue('providerId', id, { shouldDirty: true, shouldValidate: true });
    setValue('location', null);
    setValue('unitIds', []);
    setValue('stayParams', stayFieldDefaults([...fields.watch, ...fields.hold]));
    setValue('autoHold', false);
    setValue('checkIntervalMinutes', defaultInterval(next));
  };

  /** The first step (in order) with a field showing an error. */
  const firstStepWithError = (): FlowStepId | undefined =>
    STEPS.find(({ id }) =>
      stepFields(id, manifest, getValues('autoHold')).some((name) => getFieldState(name).error)
    )?.id;

  const submit = async (): Promise<boolean> => {
    if (!(await trigger())) {
      const failing = firstStepWithError();
      if (failing && failing !== step) setStep(failing);
      return false;
    }
    setSubmitError(undefined);
    try {
      const watchCreated = await create.mutateAsync(toWatchInput(getValues(), manifest));
      toast.success('Watch created');
      navigate(ROUTES.watchDetail(watchCreated.id));
      return true;
    } catch (error) {
      const apiError = toApiError(error);
      const fields = (apiError.issues ?? [])
        .map(issueField)
        .filter((name): name is WatchFieldName => Boolean(name));
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
    step === 'review' ? submit() : trigger(stepFields(step, manifest, autoHold));

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
          label="New watch steps"
          steps={STEPS}
          current={step}
          onStepChange={(id) => setStep(id as FlowStepId)}
          onContinue={onContinue}
          finalLabel="Create watch"
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
          {step === 'alerts' && manifest && <AlertsStep manifest={manifest} noun={noun} />}
          {step === 'review' && manifest && (
            <ReviewStep
              manifest={manifest}
              today={today}
              noun={noun}
              place={detail.data}
              placeLoading={detail.isLoading}
              onChangeStep={setStep}
              submitError={submitError}
            />
          )}
        </StepFlow>
      </form>
    </FormProvider>
  );
}

export default WatchFlow;
