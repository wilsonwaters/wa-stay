/**
 * Fixture mode for document windows (test-only; see `env.ts`): a provider's document
 * partition (`documents-<providerId>`, `app/document-windows.ts`) answers from the provider's
 * fixtures, `<fixturesDir>/<providerId>/manifest.json`, the routes `FixtureHttpClient` uses
 * (a document route is usually a PDF: `{ "method": "GET", "path": "/media/…/map.pdf",
 * "file": "map.pdf" }`). Files are served as they are, bytes included.
 *
 * Nothing on that partition reaches the network:
 * - `protocol.handle` answers every http(s) request: a route's file, or a 404 for a request no
 *   route matches (appended to the unexpected-requests log);
 * - its `onBeforeRequest` lets through the routes and local resources (the PDF viewer's own)
 *   and cancels everything else, logged. A session has one such listener, so it replaces the
 *   network guard's, which would cancel the routes; the allowed hosts
 *   (`WA_STAY_E2E_ALLOW_HOSTS`) do not apply here.
 *
 * `src/main/app/container.ts` passes `serveDocumentFixtures` to the document windows only in
 * fixture mode, which only an app running from source turns on.
 */

import fs from 'fs';
import path from 'path';
import type { ProviderId } from '@shared/types/provider.types';
import type { HttpMethod } from '../providers/sdk/http';
import {
  FIXTURE_MANIFEST,
  fixtureContentType,
  fixtureManifestSchema,
  matchFixtureRoute,
  type FixtureRoute,
} from './fixture-http-client';
import type { FixtureModeOptions } from './index';
import { isBlockedRequest, type GuardableSession } from './network-guard';
import { appendUnexpectedRequest } from './request-log';

/** The part of an Electron `Session` this uses. */
export interface FixtureDocumentSession extends GuardableSession {
  protocol: {
    handle(scheme: string, handler: (request: Request) => Promise<Response>): void;
  };
}

const METHODS = new Set<string>(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

export function serveDocumentFixtures(
  session: FixtureDocumentSession,
  providerId: ProviderId,
  { fixturesDir, logFile }: FixtureModeOptions
): void {
  const dir = path.join(fixturesDir, providerId);
  let routes: readonly FixtureRoute[] | undefined;
  /** The manifest's routes, read once; none when it is missing or invalid. */
  const readRoutes = (): readonly FixtureRoute[] => {
    if (routes) return routes;
    try {
      const parsed = fixtureManifestSchema.safeParse(
        JSON.parse(fs.readFileSync(path.join(dir, FIXTURE_MANIFEST), 'utf8'))
      );
      routes = parsed.success ? parsed.data.routes : [];
    } catch {
      routes = [];
    }
    return routes;
  };
  const routeFor = (method: string, url: string): FixtureRoute | undefined =>
    METHODS.has(method) ? matchFixtureRoute(readRoutes(), method as HttpMethod, url) : undefined;
  const refuse = (method: string, url: string): void =>
    appendUnexpectedRequest(logFile, { source: 'fixture-document', providerId, method, url });

  const answer = async (request: Request): Promise<Response> => {
    const route = routeFor(request.method, request.url);
    if (!route) {
      refuse(request.method, request.url);
      return new Response('No fixture for this request', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    const body =
      request.method === 'HEAD' ? null : await fs.promises.readFile(path.join(dir, route.file));
    return new Response(body, {
      status: route.status ?? 200,
      headers: { 'content-type': fixtureContentType(route) },
    });
  };
  session.protocol.handle('https', answer);
  session.protocol.handle('http', answer);

  session.webRequest.onBeforeRequest((details, callback) => {
    if (!isBlockedRequest(details.url, []) || routeFor(details.method, details.url)) {
      callback({});
      return;
    }
    refuse(details.method, details.url);
    callback({ cancel: true });
  });
}
