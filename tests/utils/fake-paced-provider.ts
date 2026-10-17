/**
 * Request pacing in tests (`src/main/providers/sdk/pacing.ts`).
 *
 * - `RecordingHttpClient`: an `HttpClient` (on `BaseHttpClient`, so redirects, timeouts and
 *   aborts behave as in the app) that answers every hop after `delayMs` on Jest's fake timers
 *   and records each request: method, URL, body, headers, the priority it was sent with, and
 *   when it was sent and ended (`performance.now()`, which fake timers drive). Its
 *   `withDefaults` views share the record.
 * - `createFakePacedProvider`: a provider whose every call goes through `ctx.http` (a catalogue
 *   of `places` locations, a place's detail, a check, and a bulk search that asks once per
 *   place), with `limits.minRequestIntervalMs: intervalMs` (10 s; 0 leaves it unpaced) and
 *   `maxConcurrentRequests: 1`. `pacedContext(manifest, inner)` builds its context with the real
 *   `createProviderContext`, so the core's pacing wraps `inner`.
 */

import {
  BaseHttpClient,
  createAbortError,
  createProviderContext,
  defineProvider,
  FakeSecretVault,
  InMemoryKeyValueStore,
  mergeHeaders,
  type HopRequest,
  type HopResponse,
  type HttpMethod,
  type HttpRequestOptions,
  type HttpResponse,
  type ProviderContext,
  type ProviderContextDeps,
  type ProviderFactory,
  type RequestPriority,
} from '@main/providers/sdk';
import { CookieJar } from '@main/providers/sdk/http-node';
import type { LocationSummary } from '@shared/types/catalog.types';
import type { LocationAvailability, ProviderManifest } from '@shared/types/provider.types';
import { makeLocationKey } from '@shared/utils/location-key';
import { createMemoryLogger, TEST_PROVIDERS_DIR, testManifest } from './fake-provider';

export interface RecordedRequest {
  method: HttpMethod;
  url: string;
  body?: string;
  headers: Record<string, string>;
  /** The priority the paced client sent it with (none when sent to this client directly). */
  priority?: RequestPriority;
  /** `performance.now()` when it was sent. */
  sentAt: number;
  /** `performance.now()` when it ended; undefined while in flight. */
  endedAt?: number;
}

/** How one hop is answered. */
export interface HopAnswer {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  /** Instead of the client's `delayMs`. */
  delayMs?: number;
  /** No response: the hop rejects with this after its delay. */
  fail?: Error;
}

export interface RecordingHttpClientOptions {
  providerId?: string;
  /** How long each hop takes (default 0). */
  delayMs?: number;
  /** The answer to each hop (default: 200 with `{}`). */
  respond?: (hop: HopRequest) => HopAnswer;
}

interface Shared {
  requests: RecordedRequest[];
  hops: HopRequest[];
  active: number;
  peak: number;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(createAbortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(createAbortError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class RecordingHttpClient extends BaseHttpClient {
  readonly providerId: string;
  readonly cookies: CookieJar;
  private readonly options: RecordingHttpClientOptions;
  private readonly shared: Shared;

  constructor(
    options: RecordingHttpClientOptions = {},
    parent?: { cookies: CookieJar; shared: Shared; headers: Record<string, string> }
  ) {
    super();
    this.options = options;
    this.providerId = options.providerId ?? 'paced';
    this.cookies = parent?.cookies ?? new CookieJar();
    this.shared = parent?.shared ?? { requests: [], hops: [], active: 0, peak: 0 };
    this.defaultHeaders = parent?.headers ?? {};
  }

  /** Every request, in the order they were sent. */
  get requests(): RecordedRequest[] {
    return this.shared.requests;
  }

  /** Every hop sent (a redirect chain is several). */
  get hops(): HopRequest[] {
    return this.shared.hops;
  }

  /** The most requests in flight at once. */
  get peakInFlight(): number {
    return this.shared.peak;
  }

  override async request(
    method: HttpMethod,
    url: string,
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse> {
    const record: RecordedRequest = {
      method,
      url,
      headers: Object.fromEntries(mergeHeaders(this.defaultHeaders, options.headers).entries()),
      sentAt: performance.now(),
      ...(options.body === undefined ? {} : { body: String(options.body) }),
      ...(options.priority ? { priority: options.priority } : {}),
    };
    this.shared.requests.push(record);
    this.shared.active++;
    this.shared.peak = Math.max(this.shared.peak, this.shared.active);
    try {
      return await super.request(method, url, options);
    } finally {
      this.shared.active--;
      record.endedAt = performance.now();
    }
  }

  override withDefaults(defaults: { headers?: Record<string, string> }): RecordingHttpClient {
    const headers = Object.fromEntries(
      mergeHeaders(this.defaultHeaders, defaults.headers).entries()
    );
    return new RecordingHttpClient(this.options, {
      cookies: this.cookies,
      shared: this.shared,
      headers,
    });
  }

  protected async send(hop: HopRequest): Promise<HopResponse> {
    this.shared.hops.push(hop);
    const answer = this.options.respond?.(hop) ?? {};
    await wait(answer.delayMs ?? this.options.delayMs ?? 0, hop.signal);
    if (answer.fail) throw answer.fail;
    const body = answer.body ?? '{}';
    return {
      status: answer.status ?? 200,
      headers: new Headers({ 'content-type': 'application/json', ...answer.headers }),
      text: () => Promise.resolve(body),
      discard: () => undefined,
    };
  }
}

export interface FakePacedProviderOptions {
  id?: string;
  /** `limits.minRequestIntervalMs`; 0 leaves the provider unpaced. Default 10 000. */
  intervalMs?: number;
  /** How many places its catalogue lists (default 8). */
  places?: number;
}

export interface FakePacedProvider {
  readonly manifest: ProviderManifest;
  readonly factory: ProviderFactory;
  /** The context the factory was called with. */
  ctx?: ProviderContext;
}

export function createFakePacedProvider(options: FakePacedProviderOptions = {}): FakePacedProvider {
  const id = options.id ?? 'paced';
  const intervalMs = options.intervalMs ?? 10_000;
  const base = `https://${id}.example`;
  const manifest = testManifest(id, {
    name: 'Paced Parks',
    shortName: 'Paced',
    capabilities: {
      catalog: true,
      catalogMode: 'full',
      availability: true,
      bulkAvailability: true,
      watches: true,
      snipes: false,
      holds: false,
      bookingImport: false,
      accessGate: false,
      account: 'none',
    },
    limits: {
      minWatchIntervalMinutes: 15,
      maxConcurrentRequests: 1,
      catalogTtlHours: 24,
      ...(intervalMs > 0 ? { minRequestIntervalMs: intervalMs } : {}),
    },
  });
  const externalIds = Array.from({ length: options.places ?? 8 }, (_, i) => String(i + 1));
  const summary = (externalId: string): LocationSummary => ({
    key: makeLocationKey(id, externalId),
    providerId: id,
    externalId,
    name: `Paced Park ${externalId}`,
    kind: 'campground',
    bookingMode: 'online',
    lat: -34 + Number(externalId) * 0.1,
    lng: 116,
    imageUrls: [],
    amenities: [],
  });

  const fake: FakePacedProvider = {
    manifest,
    factory: defineProvider(manifest, (ctx) => {
      fake.ctx = ctx;
      const check = async (
        externalId: string,
        stay: { arrival: string; departure: string },
        signal?: AbortSignal
      ): Promise<LocationAvailability> => {
        await ctx.http.postForm(
          `${base}/availability`,
          { place: externalId, arrival: stay.arrival, departure: stay.departure },
          { signal }
        );
        return {
          key: makeLocationKey(id, externalId),
          checkedAt: ctx.clock().toISOString(),
          units: [
            {
              unitId: 'u1',
              unitName: 'Site 1',
              nights: [{ date: stay.arrival, state: 'available' }],
              fullyAvailable: true,
            },
          ],
        };
      };
      return {
        links: {
          location: (externalId) => `${base}/places/${externalId}`,
          booking: (externalId) => `${base}/book/${externalId}`,
        },
        catalog: {
          async listLocations(signal) {
            // A whole catalogue may be slow to answer: the core's deadline bounds it
            await ctx.http.getJson(`${base}/places`, { signal, timeoutMs: 10 * 60_000 });
            return externalIds.map(summary);
          },
          async getLocation(externalId, signal) {
            await ctx.http.getJson(`${base}/places/${externalId}`, { signal });
            return { ...summary(externalId), units: [{ unitId: 'u1', unitName: 'Site 1' }] };
          },
        },
        availability: {
          check: (externalId, stay, { signal } = {}) => check(externalId, stay, signal),
          async search(stay, signal) {
            const entries = [];
            for (const externalId of externalIds) {
              await check(externalId, stay, signal);
              entries.push({
                key: makeLocationKey(id, externalId),
                availableUnits: 1,
                bookableUnits: 1,
              });
            }
            return entries;
          },
        },
      };
    }),
  };
  return fake;
}

/**
 * The provider's context from the real `createProviderContext` (paced when its manifest says
 * so), with `inner` as the transport and in-memory parts for the rest.
 */
export function pacedContext(
  manifest: ProviderManifest,
  inner: RecordingHttpClient,
  overrides: Partial<ProviderContextDeps> = {}
): ProviderContext {
  return createProviderContext(manifest, {
    createHttp: () => inner,
    createState: () => new InMemoryKeyValueStore(),
    vault: new FakeSecretVault(),
    logger: createMemoryLogger(),
    providersDir: TEST_PROVIDERS_DIR,
    ...overrides,
  });
}
