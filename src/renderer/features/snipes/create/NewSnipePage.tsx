import { useProviders } from '../../../api';
import { ROUTES } from '../../../app/routes';
import { Button, EmptyState, Notice, PageHeader, Spinner } from '../../../components/ui';
import { SnipeFlow } from './SnipeFlow';
import { useSnipePrefill } from './useSnipePrefill';

const NO_MANIFESTS: never[] = [];

/** `/site-sniper/new`: the new-snipe flow, filled from a prefill link when there is one. */
export function NewSnipePage() {
  const providers = useProviders();
  const manifests = providers.data ?? NO_MANIFESTS;
  const prefill = useSnipePrefill(manifests);
  const canSnipe = manifests.some((m) => m.capabilities.snipes);

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
        description="When a provider that releases sites on a schedule is added, you can create a snipe here."
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
        description="Choose a place, your dates and when its sites are released. Site Sniper tries to hold one the moment it opens; you pay for it yourself."
        back={{ label: 'Site Sniper', href: `#${ROUTES.snipes()}` }}
      />
      {body}
    </div>
  );
}

export default NewSnipePage;
