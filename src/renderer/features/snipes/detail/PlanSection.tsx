import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { ExternalLink } from '../../../components/ExternalLink';
import { PlanReminders } from '../shared/PlanReminders';
import { planModeOf } from '../shared/planSteps';

export interface PlanSectionProps {
  snipe: SiteSnipe;
  manifest: ProviderManifest;
  now: Date;
}

/**
 * An Open Day plan's reminders on its page (§12.39): each at its time, the done ones marked,
 * the checklist, and "Open {shortName}", where the person joins the queue and books on the
 * day. Nothing for a snipe that is not a plan.
 */
export function PlanSection({ snipe, manifest, now }: PlanSectionProps) {
  const mode = planModeOf(snipe, manifest);
  if (!mode) return null;
  return (
    <div className="flex flex-col gap-4">
      <PlanReminders
        manifest={manifest}
        mode={mode}
        releaseAt={snipe.releaseAt ? new Date(snipe.releaseAt) : undefined}
        sent={(snipe.remindersSent ?? []).map((at) => new Date(at))}
        now={now}
        level={2}
      />
      <ExternalLink href={manifest.website} variant="secondary" className="w-fit">
        Open {manifest.shortName}
      </ExternalLink>
    </div>
  );
}

export default PlanSection;
