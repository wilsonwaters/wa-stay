import { useCallback, useMemo } from 'react';
import { Crosshair, Plus } from 'lucide-react';
import { useCatalogPlaces, useProviders, useSnipes, useSnipeUpdates } from '../../api';
import { providerToday } from '../../components/stay/providerToday';
import { ROUTES } from '../../app/routes';
import { ComingSoonBanner } from '../../components/ComingSoonBanner';
import {
  Button,
  EmptyState,
  Notice,
  PageHeader,
  Skeleton,
  VisuallyHidden,
} from '../../components/ui';
import { useNow } from '../../hooks/useNow';
import { SnipeCard } from './list/SnipeCard';
import { sortSnipes } from './shared/snipeState';
import { HoldAlert, useStatusAnnouncements } from './shared/useStatusAnnouncements';

/**
 * `/site-sniper`: every snipe. Pushed updates (`snipe:updated`) change a card in place; the
 * page never swaps for a spinner after the first load, and it never re-renders on a countdown
 * tick: only each card's countdown does.
 */
export function SnipesPage() {
  useSnipeUpdates();
  const snipes = useSnipes();
  const providers = useProviders();
  const now = useNow();
  const manifests = useMemo(() => providers.data ?? [], [providers.data]);
  const manifestOf = useCallback((id: string) => manifests.find((m) => m.id === id), [manifests]);
  const alert = useStatusAnnouncements(snipes.data, manifestOf);
  const canSnipe = !providers.isSuccess || manifests.some((m) => m.capabilities.snipes);
  const list = useMemo(() => sortSnipes(snipes.data ?? []), [snipes.data]);
  const places = useCatalogPlaces(list.length > 0);

  const newSnipe = canSnipe ? (
    <Button
      as="a"
      href={`#${ROUTES.snipeNew()}`}
      variant="primary"
      leadingIcon={<Plus size={18} />}
    >
      New snipe
    </Button>
  ) : (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="primary"
        leadingIcon={<Plus size={18} />}
        disabled
        aria-describedby="no-snipe-provider"
      >
        New snipe
      </Button>
      <p id="no-snipe-provider" className="text-sm text-fg-muted">
        No provider supports Site Sniper yet
      </p>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8 lg:px-8">
      <PageHeader
        title="Site Sniper"
        description="Hold a hard-to-get site the moment it is released, then pay for it yourself."
        actions={newSnipe}
      />
      <ComingSoonBanner featureName="Site Sniper" />
      <HoldAlert message={alert} />

      {providers.isError && (
        <Notice
          tone="warning"
          title="Provider details couldn't be loaded"
          actions={
            <Button variant="secondary" size="sm" onClick={() => void providers.refetch()}>
              Try again
            </Button>
          }
        >
          Your snipes are below; their providers show as unknown until this works.
        </Notice>
      )}

      {snipes.isPending && (
        <div aria-busy="true" className="flex flex-col gap-4">
          <p role="status">
            <VisuallyHidden>Loading snipes</VisuallyHidden>
          </p>
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-lg" />
          ))}
        </div>
      )}

      {snipes.isError && (
        <Notice
          tone="danger"
          title="Snipes couldn't be loaded"
          actions={
            <Button variant="secondary" size="sm" onClick={() => void snipes.refetch()}>
              Try again
            </Button>
          }
        >
          {snipes.error.message}
        </Notice>
      )}

      {snipes.isSuccess && list.length === 0 && (
        <EmptyState
          size="md"
          icon={<Crosshair size={24} />}
          accent="sun"
          title={canSnipe ? 'No snipes yet' : 'No provider supports Site Sniper yet'}
          description={
            canSnipe
              ? 'A snipe waits for a place’s sites to be released and tries to hold one for you the moment they open.'
              : 'When a provider that releases sites on a schedule is added, you can create a snipe here.'
          }
          actions={
            canSnipe ? (
              <Button as="a" href={`#${ROUTES.snipeNew()}`} variant="secondary">
                Create your first snipe
              </Button>
            ) : undefined
          }
        />
      )}

      {list.length > 0 && (
        <ul aria-label="Snipes" className="flex flex-col gap-3">
          {list.map((snipe) => {
            const manifest = manifestOf(snipe.providerId);
            return (
              <li key={snipe.id}>
                <SnipeCard
                  snipe={snipe}
                  manifest={manifest}
                  today={providerToday(manifest, now)}
                  place={places.byKey.get(snipe.locationKey)}
                  placeLoading={places.loading}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default SnipesPage;
