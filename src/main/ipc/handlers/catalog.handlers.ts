/**
 * `catalog` handlers: the location catalogue service (`core/catalog`). Requests are parsed
 * with the contract's schemas by `handle()`, and provider errors map through `toApiError`
 * there. Syncs reach the renderer as `catalog:updated` events, which the service emits on the
 * renderer events bus. `openDocument` opens a location's document in a document window
 * (`app/document-windows.ts`), at the address main cached with the detail.
 */

import { contract } from '@shared/contracts';
import type { AppContainer } from '../../app/container';
import type { Handle } from '../handle';

export function registerCatalogHandlers(handle: Handle, c: AppContainer): void {
  const api = contract.catalog;
  const catalog = c.catalogService;

  handle(api.search, (query) => catalog.search(query));
  handle(api.get, ({ key }) => catalog.get(key));
  handle(api.availability, ({ stay, providerIds, bbox }) =>
    catalog.availability(stay, { providerIds, bbox })
  );
  handle(api.checkLocation, ({ key, stay }) => catalog.checkLocation(key, stay));
  handle(api.refresh, ({ providerId }) => catalog.refresh(providerId));
  handle(api.status, () => catalog.status());
  // The address comes from the cached detail, never from the renderer
  handle(api.openDocument, async ({ locationKey, documentId }) => {
    const document = await catalog.resolveDocument(locationKey, documentId);
    await c.documentWindows.open({
      key: document.key,
      providerId: document.providerId,
      providerName: document.providerName,
      url: document.url,
      title: `${document.locationName} · ${document.title}`,
      documentName: document.title.toLowerCase(),
      mediaType: document.mediaType,
    });
  });
}
