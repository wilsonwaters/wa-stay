import { useProviders } from '../../../api';
import { ROUTES } from '../../../app/routes';
import { Button, EmptyState, Notice, PageHeader, Spinner } from '../../../components/ui';
import { usePrefill } from './usePrefill';
import { WatchFlow } from './WatchFlow';

const NO_MANIFESTS: never[] = [];

/** `/watches/new`: the create-watch flow, filled from a prefill link when there is one. */
export function NewWatchPage() {
  const providers = useProviders();
  const manifests = providers.data ?? NO_MANIFESTS;
  const prefill = usePrefill(manifests);
  const canWatch = manifests.some((m) => m.capabilities.watches);

  let body;
  if (providers.isPending || (providers.isSuccess && !prefill.ready)) {
    body = <Spinner label="Getting the new watch ready" />;
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
  } else if (!canWatch) {
    body = (
      <EmptyState
        size="md"
        title="No provider supports watches yet"
        description="When a provider that can be watched is added, you can create a watch here."
      />
    );
  } else {
    body = (
      <WatchFlow
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
        title="New watch"
        description="Choose a place and dates, and WA Stay will tell you when something frees up."
        back={{ label: 'Watches', href: `#${ROUTES.watches()}` }}
      />
      {body}
    </div>
  );
}

export default NewWatchPage;
