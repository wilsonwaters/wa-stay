/**
 * `FixtureHttpClient`: the `HttpClient` every provider gets in network-free fixture mode
 * (`WA_STAY_E2E_FIXTURES_DIR`, test-only; see `env.ts`).
 *
 * It answers from recorded responses instead of the network. Each provider has a folder,
 * `<fixturesDir>/<providerId>/`, with a `manifest.json`:
 *
 * ```json
 * { "routes": [{ "method": "GET", "path": "/api/campground_map/", "file": "campground_map.json" }] }
 * ```
 *
 * A route is `{ method, path, query?, form?, status?, file, contentType? }`. A request matches
 * the first route with the same method and URL path (exactly, trailing slash included) whose
 * `query` values all equal the request's, and whose `form` values all equal the fields of the
 * request's body read as `application/x-www-form-urlencoded` (so two POSTs to one path are
 * told apart by their form). Parameters and fields the route leaves out may have any value; a
 * route without `query` matches any query string, one without `form` any body, and one with
 * `form` never a request without a body. The response has the route's `status` (default
 * 200), the file's contents and `contentType` (default from the file extension). The host is
 * not compared.
 *
 * A request no route matches is never sent anywhere: it is appended to the
 * unexpected-requests log (with its form fields and their values, if it had a body) and
 * rejected with `UnexpectedNetworkRequestError`, whose message names the form fields (never
 * their values: an error can reach the app's log) and the manifest to add the route to.
 *
 * Built on `BaseHttpClient`, so redirects, timeouts, aborts, cookies and the JSON helpers
 * behave exactly as in the real clients.
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { ProviderId } from '@shared/types/provider.types';
import { ProviderError, ProviderHttpError } from '../providers/sdk/errors';
import {
  BaseHttpClient,
  type HopRequest,
  type HopResponse,
  type HttpMethod,
} from '../providers/sdk/http';
import { CookieJar } from '../providers/sdk/http-node';
import { appendUnexpectedRequest } from './request-log';

const routeSchema = z.strictObject({
  method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().startsWith('/'),
  query: z.record(z.string(), z.string()).optional(),
  form: z.record(z.string(), z.string()).optional(),
  status: z.number().int().min(100).max(599).optional(),
  file: z.string().min(1),
  contentType: z.string().min(1).optional(),
});

const manifestSchema = z.object({ routes: z.array(routeSchema) });

/** Validates a fixture `manifest.json`. */
export const fixtureManifestSchema = manifestSchema;

export type FixtureRoute = z.infer<typeof routeSchema>;
export type FixtureManifest = z.infer<typeof manifestSchema>;

export const FIXTURE_MANIFEST = 'manifest.json';

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.html': 'text/html; charset=utf-8',
  '.pdf': 'application/pdf',
};

/** A route's content type: its own, else from its file's extension, else plain text. */
export function fixtureContentType(route: FixtureRoute): string {
  return (
    route.contentType ??
    CONTENT_TYPES[path.extname(route.file).toLowerCase()] ??
    'text/plain; charset=utf-8'
  );
}

/** A request body's fields, read as `application/x-www-form-urlencoded`; none without a body. */
function formFields(body: string | undefined): Record<string, string> | undefined {
  return body === undefined ? undefined : Object.fromEntries(new URLSearchParams(body));
}

/** Whether every value in `wanted` equals `actual`'s (`actual` missing: only without `wanted`). */
function hasValues(
  wanted: Record<string, string> | undefined,
  actual: URLSearchParams | undefined
): boolean {
  if (!wanted) return true;
  return actual !== undefined && Object.entries(wanted).every(([n, v]) => actual.get(n) === v);
}

/** The first route `method`, `url` and the request's `body` (its form, if any) match, if any. */
export function matchFixtureRoute(
  routes: readonly FixtureRoute[],
  method: HttpMethod,
  url: string,
  body?: string
): FixtureRoute | undefined {
  const target = new URL(url);
  const form = body === undefined ? undefined : new URLSearchParams(body);
  return routes.find(
    (route) =>
      route.method === method &&
      route.path === target.pathname &&
      hasValues(route.query, target.searchParams) &&
      hasValues(route.form, form)
  );
}

/** A provider request that no fixture route answers. It was logged, never sent. */
export class UnexpectedNetworkRequestError extends ProviderHttpError {
  readonly method: HttpMethod;
  /** The names of the request's form fields, when it had a body (never their values). */
  readonly formFields?: string[];

  constructor(options: {
    providerId: ProviderId;
    method: HttpMethod;
    url: string;
    formFields?: string[];
    manifest: string;
  }) {
    const { providerId, method, url, formFields, manifest } = options;
    const fields = formFields ? ` with form fields ${formFields.join(', ') || '(none)'}` : '';
    super({
      providerId,
      status: 0,
      url,
      reason: 'blocked',
      message: `${providerId}: no fixture for ${method} ${url}${fields}; add a route to ${manifest}`,
    });
    this.name = 'UnexpectedNetworkRequestError';
    this.method = method;
    if (formFields) this.formFields = formFields;
  }
}

export interface FixtureHttpClientOptions {
  providerId: ProviderId;
  /** The folder holding `<providerId>/manifest.json`. */
  fixturesDir: string;
  /** The unexpected-requests log (`unexpectedRequestsLogPath`). */
  logFile: string;
}

export class FixtureHttpClient extends BaseHttpClient {
  readonly providerId: ProviderId;
  readonly cookies = new CookieJar();
  private readonly dir: string;
  private readonly manifestPath: string;
  private readonly logFile: string;
  private manifest?: FixtureManifest;

  constructor({ providerId, fixturesDir, logFile }: FixtureHttpClientOptions) {
    super();
    this.providerId = providerId;
    this.dir = path.join(fixturesDir, providerId);
    this.manifestPath = path.join(this.dir, FIXTURE_MANIFEST);
    this.logFile = logFile;
  }

  protected async send(hop: HopRequest): Promise<HopResponse> {
    const route = matchFixtureRoute(this.routes(), hop.method, hop.url, hop.body);
    if (!route) {
      const form = formFields(hop.body);
      appendUnexpectedRequest(this.logFile, {
        source: 'fixture-http',
        providerId: this.providerId,
        method: hop.method,
        url: hop.url,
        ...(form ? { form } : {}),
      });
      throw new UnexpectedNetworkRequestError({
        providerId: this.providerId,
        method: hop.method,
        url: hop.url,
        ...(form ? { formFields: Object.keys(form) } : {}),
        manifest: this.manifestPath,
      });
    }

    const file = path.join(this.dir, route.file);
    let body: string;
    try {
      body = hop.method === 'HEAD' ? '' : await fs.promises.readFile(file, 'utf8');
    } catch (error) {
      throw new ProviderError({
        providerId: this.providerId,
        message: `${this.providerId}: fixture file ${file} for ${route.method} ${route.path} cannot be read`,
        cause: error,
      });
    }
    if (hop.signal.aborted) throw hop.signal.reason;

    const contentType = fixtureContentType(route);
    return {
      status: route.status ?? 200,
      headers: new Headers({ 'content-type': contentType }),
      text: () => Promise.resolve(body),
      discard: () => undefined,
    };
  }

  /** The manifest's routes, read once. No manifest means no routes. */
  private routes(): readonly FixtureRoute[] {
    if (this.manifest) return this.manifest.routes;
    if (!fs.existsSync(this.manifestPath)) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
    } catch (error) {
      throw this.invalidManifest('is not valid JSON', error);
    }
    const result = manifestSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw this.invalidManifest(
        `is invalid at ${issue.path.join('.') || 'its root'}: ${issue.message}`
      );
    }
    this.manifest = result.data;
    return this.manifest.routes;
  }

  private invalidManifest(reason: string, cause?: unknown): ProviderError {
    return new ProviderError({
      providerId: this.providerId,
      message: `${this.providerId}: fixture manifest ${this.manifestPath} ${reason}`,
      cause,
    });
  }
}
