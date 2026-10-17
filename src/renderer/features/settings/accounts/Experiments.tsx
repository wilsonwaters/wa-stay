import { useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import {
  useProviderExperiments,
  useSetExperiment,
  type ProviderExperimentState,
  type ProviderManifest,
} from '../../../api';
import type { ProviderExperiment } from '../../../../shared/types/provider.types';
import { Button, ConfirmDialog, Notice, Switch, useAnnounce } from '../../../components/ui';

export const EXPERIMENTS_TEXT = {
  heading: 'Experimental',
  restart: 'Takes effect when WA Stay restarts.',
  turnOn: 'Turn on',
  turnsOn: 'Turns on when WA Stay restarts.',
  turnsOff: 'Turns off when WA Stay restarts.',
  failed: "Couldn't turn on. See the logs, or turn it off.",
  loadFailed: "Experimental settings couldn't be loaded",
  refused: "That didn't work. Try again.",
} as const;

/** The line under a switch while its stored choice and this run differ, or none. */
export function pendingLine(state: ProviderExperimentState | undefined): string | undefined {
  if (!state) return undefined;
  if (state.enabled && state.failed) return EXPERIMENTS_TEXT.failed;
  if (state.enabled === state.active) return undefined;
  return state.enabled ? EXPERIMENTS_TEXT.turnsOn : EXPERIMENTS_TEXT.turnsOff;
}

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : EXPERIMENTS_TEXT.refused;

/**
 * A provider's "Experimental" group on its Settings → Accounts row: a switch for each
 * experiment its manifest declares, off until the person turns it on, shown to everyone. A
 * change takes effect when WA Stay restarts, and the line under the switch says so until then.
 * Turning one on asks first (its description, its warning and the restart); turning one off
 * does not, and a refusal (a stay held on the provider) shows under the switch, which stays on.
 * A switch is disabled while its change is being saved; focus stays on it (or comes back to it,
 * when the dialog closes or the switch is enabled again).
 */
export function Experiments({ manifest }: { manifest: ProviderManifest }) {
  const declared = manifest.experiments ?? [];
  const states = useProviderExperiments(manifest.id);
  const setExperiment = useSetExperiment();
  const announce = useAnnounce();
  const [confirming, setConfirming] = useState<ProviderExperiment | null>(null);
  // The last experiment asked about, so the dialog keeps its words while it closes
  const lastConfirming = useRef<ProviderExperiment | null>(null);
  if (confirming) lastConfirming.current = confirming;
  const [refusals, setRefusals] = useState<Record<string, string | undefined>>({});
  const switches = useRef(new Map<string, HTMLInputElement>());
  // A disabled switch can lose focus, and the dialog gives it back while it is disabled: once
  // the change is saved, focus that went nowhere comes back to the switch
  const keepFocus = (experiment: ProviderExperiment) =>
    requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (!focused || focused === document.body) switches.current.get(experiment.id)?.focus();
    });
  const idOf = (experiment: ProviderExperiment, part: string) =>
    `experiment-${manifest.id}-${experiment.id}-${part}`;

  const save = async (experiment: ProviderExperiment, enabled: boolean) => {
    setRefusals((current) => ({ ...current, [experiment.id]: undefined }));
    const answer = await setExperiment.mutateAsync({
      providerId: manifest.id,
      experimentId: experiment.id,
      enabled,
    });
    // Said once, when the change is made; the line stays under the switch
    const line = pendingLine(answer.find((state) => state.id === experiment.id));
    if (line) announce(line);
  };

  const turnOff = async (experiment: ProviderExperiment) => {
    try {
      await save(experiment, false);
    } catch (error) {
      setRefusals((current) => ({ ...current, [experiment.id]: messageOf(error) }));
    } finally {
      keepFocus(experiment);
    }
  };

  const confirmTurnOn = async () => {
    const experiment = confirming;
    if (!experiment) return;
    // A failure rejects: the dialog stays open and shows main's reason
    await save(experiment, true);
    setConfirming(null);
    keepFocus(experiment);
  };

  const closing = confirming ?? lastConfirming.current;
  // Still on in this run (its turn-off is waiting for the restart): turning it on again changes
  // nothing that needs a restart
  const closingActive = states.data?.find((s) => s.id === closing?.id)?.active === true;
  const saving = (experiment: ProviderExperiment) =>
    setExperiment.isPending && setExperiment.variables?.experimentId === experiment.id;
  return (
    <section
      aria-label={`${manifest.name} ${EXPERIMENTS_TEXT.heading.toLowerCase()}`}
      className="mt-4 flex max-w-prose flex-col gap-3"
    >
      <div>
        <h4 className="text-sm font-semibold text-fg">{EXPERIMENTS_TEXT.heading}</h4>
        <p className="text-sm text-fg-muted">{EXPERIMENTS_TEXT.restart}</p>
      </div>
      {states.isError ? (
        <Notice
          tone="danger"
          title={EXPERIMENTS_TEXT.loadFailed}
          actions={
            <Button variant="secondary" size="sm" onClick={() => void states.refetch()}>
              Try again
            </Button>
          }
        >
          {states.error.message}
        </Notice>
      ) : (
        declared.map((experiment) => {
          const state = states.data?.find((s) => s.id === experiment.id);
          const line = pendingLine(state);
          const refusal = refusals[experiment.id];
          const describedBy = [
            line ? idOf(experiment, 'pending') : '',
            refusal ? idOf(experiment, 'refusal') : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={experiment.id} className="flex flex-col gap-1.5">
              <Switch
                ref={(input) => {
                  if (input) switches.current.set(experiment.id, input);
                  else switches.current.delete(experiment.id);
                }}
                id={idOf(experiment, 'switch')}
                label={experiment.label}
                description={experiment.description}
                checked={state?.enabled ?? false}
                disabled={!states.isSuccess || saving(experiment)}
                aria-describedby={describedBy || undefined}
                onChange={(event) => {
                  if (event.target.checked) setConfirming(experiment);
                  else void turnOff(experiment);
                }}
              />
              {line && (
                <p
                  id={idOf(experiment, 'pending')}
                  className="text-sm font-medium text-fg-secondary"
                >
                  {line}
                </p>
              )}
              {refusal && (
                <p
                  id={idOf(experiment, 'refusal')}
                  role="alert"
                  className="flex items-start gap-1.5 text-sm font-medium text-danger"
                >
                  <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {refusal}
                </p>
              )}
            </div>
          );
        })
      )}
      <ConfirmDialog
        open={confirming !== null}
        tone="danger"
        title={`Turn on ${closing?.label ?? ''}?`}
        message={
          <div className="flex flex-col gap-3">
            <p>{closing?.description}</p>
            {closing?.warning && <p className="font-medium text-fg">{closing.warning}</p>}
            {!closingActive && <p>{EXPERIMENTS_TEXT.restart}</p>}
          </div>
        }
        confirmLabel={EXPERIMENTS_TEXT.turnOn}
        onConfirm={confirmTurnOn}
        onCancel={() => setConfirming(null)}
      />
    </section>
  );
}

export default Experiments;
