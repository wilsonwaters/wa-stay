/**
 * `RottnestClient`: the one door every request to Stay Rottnest goes through, on the provider's
 * `ctx.http` (the `persist:provider-rottnest` session in the app, paced by the core: one request
 * at a time, 60 s apart in the background). Its rules are `ai-state/research/rottnest-terms.md`
 * §9, the conditions the stakeholder accepted clause 4's risk on:
 *
 * - **One request, one path.** Only `GET https://bookings.stayrottnest.com/rates-room1`, with
 *   only the search's own fields (`hotel`, `arrival`, `departure`, `rooms`, `adults[1]`,
 *   `children[1]`). Anything else (another host, path, method or field; the booking step
 *   `/details/…`; sign-in) is a `ProviderError` and is never sent (§9.2).
 * - **No redirect followed.** A redirect to a waiting room (Queue-it) is a block, like a
 *   challenge; any other redirect is an error. Nothing is followed (§9.5).
 * - **A block** is a 403, a 429, a `cf-mitigated: challenge` header, Cloudflare's challenge page,
 *   or a waiting room (a redirect to it, or its page). It rejects with a non-retryable
 *   `ProviderHttpError` (status 429 for a 429, else 403, so the core's `isProviderBlock` stops
 *   whatever asked) and starts a **cool-down**: no request at all for 12 hours, doubled for each
 *   block in a row (with no answer between), up to 7 days, or longer when `Retry-After` asks (up
 *   to 7 days). It is kept in the provider's state, so a restart honours it. Nothing is
 *   retried, solved or worked around (§9.5).
 * - **Quiet on Open Days.** From 5:30 am to noon Perth on an Open Day, every request is refused
 *   before it is sent (`openDayQuietUntil`, §9.4).
 * - **The app's one browser identity.** The client sets only `Accept`: the partition presents
 *   the SDK's user agent and languages, the same as its windows, never rotated (§12.32, §9.5).
 *   No cookie of the person's: the partition is never signed in (§9.6).
 * - Logs name the path and the status only, never the query (the stay's dates and party).
 */

import type { ProviderId, StayQuery } from '@shared/types/provider.types';
import { todayIn } from '@shared/utils/calendar-date';
import { createLimiter, type Limiter } from '../sdk/concurrency';
import type { ProviderLogger } from '../sdk/context';
import { ProviderError, ProviderHttpError, throwIfAborted } from '../sdk/errors';
import type { HttpClient, HttpResponse } from '../sdk/http';
import type { KeyValueStore } from '../sdk/kv-store';
import { ROTTNEST_BOOKINGS_URL, ROTTNEST_RESULTS_PATH, searchQuery } from './links';
import { openDayQuietUntil, ROTTNEST_TIME_ZONE } from './open-days';

/** How long every request is refused after a first block: 12 hours. */
export const ROTTNEST_BLOCK_COOLDOWN_MS = 12 * 60 * 60_000;

/** The longest cool-down: for blocks in a row, or a `Retry-After` asking for longer. 7 days. */
export const ROTTNEST_MAX_BLOCK_COOLDOWN_MS = 7 * 24 * 60 * 60_000;

/** Where the end of a cool-down is kept in the provider's state. */
export const ROTTNEST_BLOCK_STATE_KEY = 'client.blockedUntil';

/** The only query fields a search sends: Stay Rottnest's own search form's. */
export const ROTTNEST_SEARCH_FIELDS: readonly string[] = [
  'hotel',
  'arrival',
  'departure',
  'rooms',
  'adults[1]',
  'children[1]',
];

const BOOKINGS_ORIGIN = new URL(ROTTNEST_BOOKINGS_URL).origin;

/** What turned a request away. */
type BlockCause = 'status' | 'challenge' | 'waiting-room';

interface StoredBlock {
  /** ISO timestamp. */
  until: string;
  status: 403 | 429;
  cause: BlockCause;
  durationMs: number;
  /** Blocks in a row, this one included, with no answer between. */
  strikes: number;
}

function isStoredBlock(value: unknown): value is StoredBlock {
  if (typeof value !== 'object' || value === null) return false;
  const { until, status, cause, durationMs, strikes } = value as Partial<StoredBlock>;
  return (
    typeof until === 'string' &&
    !Number.isNaN(Date.parse(until)) &&
    (status === 403 || status === 429) &&
    (cause === 'status' || cause === 'challenge' || cause === 'waiting-room') &&
    typeof durationMs === 'number' &&
    Number.isFinite(durationMs) &&
    durationMs > 0 &&
    durationMs <= ROTTNEST_MAX_BLOCK_COOLDOWN_MS &&
    Number.isInteger(strikes) &&
    (strikes ?? 0) >= 1
  );
}

/** A results page as it came back. */
export interface RottnestPage {
  url: string;
  body: string;
}

export interface RottnestClientDeps {
  providerId: ProviderId;
  /** For messages: "Stay Rottnest turned the request away…". */
  providerName: string;
  http: HttpClient;
  state: KeyValueStore;
  logger: ProviderLogger;
  clock: () => Date;
  /** `limits.maxConcurrentRequests`. */
  maxConcurrent: number;
}

/**
 * How long a `Retry-After` header asks to wait, in ms: its seconds, or the time to its date.
 * Undefined when there is none or it cannot be read.
 */
export function retryAfterMs(value: string | null, now: number): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text) * 1_000;
  const at = /[a-z]/i.test(text) ? Date.parse(text) : Number.NaN;
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** Cloudflare's challenge page: "Just a moment…" as its title, or its `cf_chl_opt` settings. */
export function isChallengePage(body: string): boolean {
  return /<title>\s*Just a moment/i.test(body) || body.includes('cf_chl_opt');
}

/** A waiting room's page or address: Queue-it's. */
export function isWaitingRoom(text: string): boolean {
  return /queue-it\.net|queueit/i.test(text);
}

/** "12 hours", "2 days", for the log. */
function describeDuration(ms: number): string {
  const hours = Math.ceil(ms / (60 * 60_000));
  if (hours < 48) return hours === 1 ? '1 hour' : `${hours} hours`;
  return `${Math.ceil(hours / 24)} days`;
}

export class RottnestClient {
  private readonly limit: Limiter;
  private readonly when: Intl.DateTimeFormat;

  constructor(private readonly deps: RottnestClientDeps) {
    this.limit = createLimiter(deps.maxConcurrent);
    this.when = new Intl.DateTimeFormat('en-AU', {
      timeZone: ROTTNEST_TIME_ZONE,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  /** The results page of a search for `stay`: every room type on the island. */
  search(stay: StayQuery, options: { signal?: AbortSignal } = {}): Promise<RottnestPage> {
    return this.get(ROTTNEST_RESULTS_PATH, searchQuery(stay), options.signal);
  }

  /**
   * GETs `path` with `query`, after the rules above. Public for its tests: the module asks only
   * `search`.
   */
  async get(
    path: string,
    query: Record<string, string>,
    signal?: AbortSignal
  ): Promise<RottnestPage> {
    throwIfAborted(signal);
    this.guard(path, query);
    const url = `${BOOKINGS_ORIGIN}${path}`;
    return this.limit(async () => {
      throwIfAborted(signal);
      this.refuseOnOpenDay();
      const block = await this.currentBlock();
      if (block) throw this.blockError(url, block);
      throwIfAborted(signal);
      const response = await this.deps.http.request('GET', url, {
        query,
        headers: { Accept: 'text/html' },
        redirect: 'manual',
        signal,
      });
      return this.read(response, url);
    });
  }

  /** Throws, sending nothing, unless the request is the search with its own fields only. */
  private guard(path: string, query: Record<string, string>): void {
    const extra = Object.keys(query).filter((name) => !ROTTNEST_SEARCH_FIELDS.includes(name));
    const why =
      path !== ROTTNEST_RESULTS_PATH
        ? `only ${ROTTNEST_RESULTS_PATH} is asked`
        : extra.length > 0
          ? `the search has no field ${extra.join(', ')}`
          : undefined;
    if (why === undefined) return;
    this.deps.logger.warn(`Refused GET ${path}: ${why}; nothing sent`);
    throw new ProviderError({
      providerId: this.deps.providerId,
      message: `${this.deps.providerName}: WA Stay never sends that request (${why})`,
    });
  }

  /** Throws, sending nothing, during an Open Day's quiet hours. */
  private refuseOnOpenDay(): void {
    const now = this.deps.clock();
    const until = openDayQuietUntil(now, todayIn(ROTTNEST_TIME_ZONE, now));
    if (!until) return;
    throw new ProviderError({
      providerId: this.deps.providerId,
      message:
        `It's ${this.deps.providerName}'s Open Day, so WA Stay doesn't check this morning. ` +
        `Checks start again at noon.`,
    });
  }

  private async read(response: HttpResponse, url: string): Promise<RottnestPage> {
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400) {
      if (location !== null && isWaitingRoom(location)) {
        const block = await this.startBlock(403, 'waiting-room', undefined);
        throw this.blockError(url, block);
      }
      // Followed nowhere: the search should answer itself
      this.deps.logger.warn(`${ROTTNEST_RESULTS_PATH} answered a redirect (${response.status})`);
      throw new ProviderHttpError({
        providerId: this.deps.providerId,
        status: response.status,
        url,
        reason: 'redirect',
        retryable: false,
        message: `${this.deps.providerName} sent the search somewhere else (HTTP ${response.status}).`,
      });
    }
    const body = await response.text();
    const challenged =
      response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge' ||
      ((response.status === 200 || response.status === 503) && isChallengePage(body));
    const waitingRoom = !challenged && response.status === 200 && isWaitingRoom(body);
    if (challenged || waitingRoom || response.status === 403 || response.status === 429) {
      const block = await this.startBlock(
        response.status === 429 ? 429 : 403,
        challenged ? 'challenge' : waitingRoom ? 'waiting-room' : 'status',
        retryAfterMs(response.headers.get('retry-after'), this.deps.clock().getTime())
      );
      throw this.blockError(url, block);
    }
    // An answer: the run of blocks, if any, is over
    if (response.ok && (await this.deps.state.get(ROTTNEST_BLOCK_STATE_KEY)) !== undefined) {
      await this.deps.state.delete(ROTTNEST_BLOCK_STATE_KEY);
    }
    if (!response.ok) {
      throw new ProviderHttpError({
        providerId: this.deps.providerId,
        status: response.status,
        url,
      });
    }
    return { url, body };
  }

  /**
   * The cool-down in force now, if any. One that ends further from now than its own length (the
   * clock was set back) is cut to that length from now, and kept so.
   */
  private async currentBlock(): Promise<StoredBlock | undefined> {
    const stored = await this.deps.state.get<unknown>(ROTTNEST_BLOCK_STATE_KEY);
    if (!isStoredBlock(stored)) return undefined;
    const now = this.deps.clock().getTime();
    const until = Date.parse(stored.until);
    if (until <= now) return undefined;
    if (until <= now + stored.durationMs) return stored;
    const cut: StoredBlock = { ...stored, until: new Date(now + stored.durationMs).toISOString() };
    await this.deps.state.set(ROTTNEST_BLOCK_STATE_KEY, cut);
    return cut;
  }

  /**
   * Starts a cool-down: 12 hours, doubled for each block before it in a row (one whose
   * cool-down ended less than 7 days ago, with no answer since), or what `Retry-After` asked
   * when that is longer; never more than 7 days.
   */
  private async startBlock(
    status: 403 | 429,
    cause: BlockCause,
    retryAfter: number | undefined
  ): Promise<StoredBlock> {
    const now = this.deps.clock().getTime();
    const previous = await this.deps.state.get<unknown>(ROTTNEST_BLOCK_STATE_KEY);
    const inARow =
      isStoredBlock(previous) && Date.parse(previous.until) > now - ROTTNEST_MAX_BLOCK_COOLDOWN_MS;
    const strikes = inARow ? previous.strikes + 1 : 1;
    const doubled = ROTTNEST_BLOCK_COOLDOWN_MS * 2 ** Math.min(strikes - 1, 8);
    const durationMs = Math.min(Math.max(doubled, retryAfter ?? 0), ROTTNEST_MAX_BLOCK_COOLDOWN_MS);
    const block: StoredBlock = {
      until: new Date(now + durationMs).toISOString(),
      status,
      cause,
      durationMs,
      strikes,
    };
    await this.deps.state.set(ROTTNEST_BLOCK_STATE_KEY, block);
    const pause = describeDuration(durationMs);
    const what =
      cause === 'challenge'
        ? 'a security check'
        : cause === 'waiting-room'
          ? 'a waiting room'
          : `HTTP ${status}`;
    this.deps.logger.warn(`Turned away (${what}); no requests for ${pause}`);
    return block;
  }

  private blockError(url: string, block: StoredBlock): ProviderHttpError {
    const why =
      block.cause === 'challenge'
        ? 'a security check'
        : block.cause === 'waiting-room'
          ? 'its waiting room'
          : `HTTP ${block.status}`;
    const until = this.when.format(new Date(block.until)).replace(',', '');
    return new ProviderHttpError({
      providerId: this.deps.providerId,
      status: block.status,
      url,
      reason: 'status',
      retryable: false,
      message:
        `${this.deps.providerName} turned the check away (${why}). ` +
        `WA Stay won't ask again until ${until}.`,
    });
  }
}
