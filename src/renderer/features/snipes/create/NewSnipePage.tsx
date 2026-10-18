import { useProviders } from '../../../api';
import { ROUTES } from '../../../app/routes';
import { Button, EmptyState, Notice, PageHeader, Spinner } from '../../../components/ui';
import { NO_SNIPE_PROVIDER_DESCRIPTION, sniperNoun } from '../shared/snipeNouns';
import { SnipeFlow } from './SnipeFlow';
import { useSnipePrefill } from './useSnipePrefill';

const NO_MANIFESTS: never[] = [];

/** `/site-sniper/new`: the new-snipe flow, filled from a prefill link when there is one. */
export function NewSnipePage() {
  const providers = useProviders();
  const manifests = providers.data ?? NO_MANIFESTS;
  const prefill = useSnipePrefill(manifests);
  const canSnipe = manifests.some((m) => m.capabilities.snipes);
  // What the providers with Site Sniper call their units (R9): ParkStay's sites
  const noun = sniperNoun(manifests);

  let body;
  if (providers.isPending || (providers.isSuccess && !prefill.ready)) {
    body = <Spinner label="Getting the new snipe ready" />;
  } else if (providers.isError) {
    body = (
      <Notice
        tone="danger"
        title="Providers couldn't be loaded"
        actions={
          <Button variant="secondary" size="sm" onClick={() => void providers.refetch()}>
            Try again
          </Button>
        }
      >
        {providers.error.message}
      </Notice>
    );
  } else if (!canSnipe) {
    body = (
      <EmptyState
        size="md"
        title="No provider supports Site Sniper yet"
        description={NO_SNIPE_PROVIDER_DESCRIPTION}
      />
    );
  } else {
    body = (
      <SnipeFlow
        manifests={manifests}
        initialValues={prefill.values}
        initialStep={prefill.step}
        notices={prefill.notices}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8 lg:px-8">
      <PageHeader
        title="New snipe"
        description={`Choose a place, your dates and when its ${noun.many} are released. Site Sniper alerts you the moment one opens or, where the provider allows it, tries to hold it; you book and pay yourself.`}
        back={{ label: 'Site Sniper', href: `#${ROUTES.snipes()}` }}
      />
      {body}
    </div>
  );
}

export default NewSnipePage;
