/**
 * `ProviderAccountService`: the person's account with each provider (brief D2, D5;
 * architecture-notes §4, §12.32). Provider-agnostic: it finds providers through the registry,
 * asks their `auth.isSignedIn` with the provider's own HTTP client, and opens sign-in windows
 * through `ProviderWindowOpener` (`app/provider-windows.ts`).
 *
 * **Stored status.** `provider_accounts.status` is the last *definite* answer: `unknown`
 * (never answered), `signed-in` or `signed-out`. A check that comes back `unknown` (the
 * provider's queue, a 5xx, no network, a timeout) writes nothing, so a signed-in account is
 * not lost to a busy evening. `users.email` is never read as a sign-in.
 *
 * **`status(id)`** is single-flight per provider (concurrent callers share one request) with
 * a 60 s result cache (`force` skips the cache, never the single flight), and a 15 s limit.
 * An answer that was not definite (the provider's queue, a 5xx, no network) is reused for
 * 5 s only, so the next look asks again soon.
 * A definite answer upserts the row: status, the profile's email and name, `last_checked_at`,
 * and `last_signed_in_at` on the move to signed in. `account:updated` is emitted only when
 * something the person can see changed (status, email, name, last sign-in).
 *
 * **`signIn(id)`** opens the provider's `signInUrl` in a sign-in window on its partition and
 * resolves once sign-in is confirmed or the window closes. One window per provider: a second
 * call focuses it and returns the same promise. Completion needs a confirming check, since a
 * completion page can also say the session expired:
 * - a navigation to a `completionUrlPatterns` page checks at once (`force`);
 * - every 3 s, while the window shows the provider's own site (the `signInUrl` origin), it
 *   checks again. On the identity provider's or queue's pages nothing can have changed yet, so
 *   it does not ask.
 * When the person closes the window, one more check (from the cache when fresh) makes sure a
 * sign-in that finished between two polls is not missed. When the window's first page is
 * blocked or cannot be loaded, the window closes itself and `signIn` rejects with that
 * `ProviderError` (`PROVIDER_ERROR`). The window is told the provider's waiting-room origins
 * (`access.waitingRoomOrigins`), so a queue that sends the person to the provider's home page
 * brings them back to the sign-in page.
 *
 * **`signOut(id)`** refuses with `ACCOUNT_BUSY` while the provider's session holds something
 * a sign-out would lose (a queue place, a hold in progress or held), otherwise clears the
 * partition (cookies, storage, HTTP auth) and stores `signed-out`, keeping the email as a
 * hint. It touches nothing else: never the local profile row (§12.22).
 *
 * **`ensureForHolds(id)`** is generic: for a provider whose account is `required-for-holds`
 * or `required`, it throws `ProviderAuthRequiredError` unless the account is signed in.
 * ParkStay's account is `optional` (§12.32), so it never blocks a ParkStay hold.
 *
 * **`recheck(id)`** checks once more after a payment window closes: the person may have
 * signed in on the provider's page while paying.
 */

import type { EventSink } from '@shared/contracts/events';
import type {
  AccountStatus,
  ProviderAccount,
  ProviderId,
  ProviderManifest,
} from '@shared/types/provider.types';
import type {
  ProviderAccountRecord,
  ProviderAccountRepository,
  ProviderAccountState,
  ProviderAccountUpsert,
} from '../../database/repositories/provider-account.repository';
import type { ProviderRegistry } from '../../providers/registry';
import type { ProviderLogger } from '../../providers/sdk/context';
import { ProviderAuthRequiredError, ProviderCapabilityError } from '../../providers/sdk/errors';
import type { AccommodationProvider, BrowserSessionAuth } from '../../providers/sdk/provider';
import { matchesOrigin, matchesUrlPattern } from '../../providers/sdk/url-patterns';
import { AppError } from '../../utils/app-error';
import type {
  AccountGate,
  ProviderSessionStore,
  ProviderWindowHandle,
  ProviderWindowOpener,
} from './ports';

export interface AccountTimings {
  /** How long a check's definite answer is reused. */
  cacheMs: number;
  /** How long an answer that was not definite (`unknown`) is reused. */
  unknownCacheMs: number;
  /** The most a check may take. */
  probeTimeoutMs: number;
  /** How often an open sign-in window is checked, while it shows the provider's own site. */
  pollMs: number;
  /** At startup, accounts last answered longer ago than this are checked again. */
  staleMs: number;
  /** How long after startup that check waits. */
  startupDelayMs: number;
}

export const DEFAULT_ACCOUNT_TIMINGS: Readonly<AccountTimings> = Object.freeze({
  cacheMs: 60_000,
  unknownCacheMs: 5_000,
  probeTimeoutMs: 15_000,
  pollMs: 3_000,
  staleMs: 6 * 60 * 60_000,
  startupDelayMs: 5_000,
});

export interface ProviderAccountServiceDeps {
  providers: Pick<ProviderRegistry, 'get' | 'list' | 'httpOf'>;
  accounts: Pick<ProviderAccountRepository, 'get' | 'upsert'>;
  windows: ProviderWindowOpener;
  sessions: ProviderSessionStore;
  events: EventSink;
  /**
   * True while the provider's session holds something a sign-out would lose at `now` (the
   * service's clock): a queue place, a hold being placed, or a hold waiting for payment.
   */
  isBusy(providerId: ProviderId, now: Date): boolean;
  logger: ProviderLogger;
  clock?: () => Date;
  timings?: Partial<AccountTimings>;
}

interface Probe {
  promise: Promise<ProviderAccount>;
  controller: AbortController;
}

interface SignInSession {
  readonly providerId: ProviderId;
  readonly window: ProviderWindowHandle;
  readonly promise: Promise<ProviderAccount>;
  resolve(account: ProviderAccount): void;
  reject(error: Error): void;
  settled: boolean;
  pollTimer?: ReturnType<typeof setTimeout>;
}

const REQUIRES_SIGN_IN_FOR_HOLDS = new Set(['required-for-holds', 'required']);

export class ProviderAccountService implements AccountGate {
  private readonly providers: ProviderAccountServiceDeps['providers'];
  private readonly repo: ProviderAccountServiceDeps['accounts'];
  private readonly windows: ProviderWindowOpener;
  private readonly sessions: ProviderSessionStore;
  private readonly events: EventSink;
  private readonly isBusy: (providerId: ProviderId, now: Date) => boolean;
  private readonly log: ProviderLogger;
  private readonly clock: () => Date;
  private readonly timings: AccountTimings;

  private readonly probes = new Map<ProviderId, Probe>();
  private readonly cache = new Map<
    ProviderId,
    { at: number; ttlMs: number; account: ProviderAccount }
  >();
  /** Bumped by sign-out: a check that started before it records nothing. */
  private readonly epochs = new Map<ProviderId, number>();
  private readonly signIns = new Map<ProviderId, SignInSession>();
  private startupTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(deps: ProviderAccountServiceDeps) {
    this.providers = deps.providers;
    this.repo = deps.accounts;
    this.windows = deps.windows;
    this.sessions = deps.sessions;
    this.events = deps.events;
    this.isBusy = deps.isBusy;
    this.log = deps.logger.child({ module: 'accounts' });
    this.clock = deps.clock ?? (() => new Date());
    this.timings = { ...DEFAULT_ACCOUNT_TIMINGS, ...deps.timings };
  }

  /** An account for every provider that has sign-in, from the stored rows. No network. */
  list(): ProviderAccount[] {
    return this.providers
      .list()
      .filter((manifest) => manifest.capabilities.account !== 'none')
      .map((manifest) => this.toAccount(manifest, this.repo.get(manifest.id)));
  }

  /** The stored (last definite) state. Synchronous; no network. */
  storedState(providerId: ProviderId): ProviderAccountState {
    return this.repo.get(providerId)?.status ?? 'unknown';
  }

  /** Asks the provider whether its session is signed in (see the class comment). */
  status(providerId: ProviderId, options: { force?: boolean } = {}): Promise<ProviderAccount> {
    const provider = this.accountProvider(providerId);
    const inFlight = this.probes.get(providerId);
    if (inFlight) return inFlight.promise;
    if (!options.force) {
      const cached = this.cache.get(providerId);
      if (cached && this.clock().getTime() - cached.at < cached.ttlMs) {
        return Promise.resolve(cached.account);
      }
    }
    if (this.disposed) return Promise.resolve(this.accountOf(provider.manifest));

    const controller = new AbortController();
    const promise: Promise<ProviderAccount> = this.probe(provider, controller).finally(() => {
      if (this.probes.get(providerId)?.promise === promise) this.probes.delete(providerId);
    });
    this.probes.set(providerId, { promise, controller });
    return promise;
  }

  /** Opens the sign-in window; resolves when sign-in is confirmed or the window closes. */
  signIn(providerId: ProviderId): Promise<ProviderAccount> {
    const { provider, auth } = this.browserSessionAuth(providerId);
    const open = this.signIns.get(providerId);
    if (open) {
      open.window.focus();
      return open.promise;
    }
    return this.startSignIn(provider, auth, auth.signInUrl).promise;
  }

  /**
   * Loads a sign-in link the person pasted (an emailed magic link, PQ1) in the sign-in window,
   * opening one when none is open. The link must be on one of the provider's sign-in origins;
   * anything else is `VALIDATION` and is never loaded. The outcome arrives as
   * `account:updated`.
   */
  openSignInLink(providerId: ProviderId, url: string): void {
    const { provider, auth } = this.browserSessionAuth(providerId);
    if (!matchesOrigin(url, auth.allowedOrigins)) {
      throw new AppError(
        'VALIDATION',
        `That link is not a ${provider.manifest.shortName} sign-in link`,
        { issues: ['url'] }
      );
    }
    const open = this.signIns.get(providerId);
    if (open) {
      open.window.load(url);
      open.window.focus();
      return;
    }
    this.startSignIn(provider, auth, url);
  }

  /** Signs out (see the class comment). */
  async signOut(providerId: ProviderId): Promise<ProviderAccount> {
    const provider = this.accountProvider(providerId);
    const { manifest } = provider;
    if (this.isBusy(providerId, this.clock())) {
      throw new AppError(
        'ACCOUNT_BUSY',
        `A snipe or hold on ${manifest.shortName} is in progress. Signing out now would lose it; try again once it has finished.`
      );
    }

    const open = this.signIns.get(providerId);
    if (open) {
      this.settle(open, this.accountOf(manifest));
      open.window.close();
    }
    // Any check in flight answers for the session that is about to go: it records nothing.
    this.epochs.set(providerId, this.epochOf(providerId) + 1);
    this.probes.get(providerId)?.controller.abort();
    this.cache.delete(providerId);

    await this.sessions.clear(providerId);
    await this.flush(providerId);

    const now = this.clock();
    const after = this.repo.upsert({ providerId, status: 'signed-out', lastCheckedAt: now }, now);
    const account = this.toAccount(manifest, after);
    this.log.info(`Account ${providerId}: signed out; its session was cleared`);
    this.events.emit('account:updated', account);
    return account;
  }

  /**
   * For a provider whose holds need an account (`required-for-holds` or `required`): throws
   * `ProviderAuthRequiredError` (`AUTH_REQUIRED`) unless it is signed in. A no-op for
   * `optional` and `none` providers, ParkStay among them.
   */
  async ensureForHolds(providerId: ProviderId): Promise<void> {
    const { manifest } = this.providers.get(providerId);
    if (!REQUIRES_SIGN_IN_FOR_HOLDS.has(manifest.capabilities.account)) return;
    const account = await this.status(providerId);
    if (account.status !== 'signed-in') {
      throw new ProviderAuthRequiredError(providerId, `Sign in to ${manifest.shortName} first`);
    }
  }

  /**
   * One fresh check of the account, after a provider window other than sign-in closed (the
   * person may have signed in, or out, on a payment page). Never rejects; nothing for a
   * provider without accounts.
   */
  async recheck(providerId: ProviderId): Promise<void> {
    if (this.disposed) return;
    try {
      const provider = this.providers.get(providerId);
      if (provider.manifest.capabilities.account === 'none' || !provider.auth) return;
      await this.status(providerId, { force: true });
    } catch (error) {
      this.log.debug(
        `Account ${providerId}: check after the window closed failed (${String(error)})`
      );
    }
  }

  /** Schedules `refreshStale` a few seconds after startup. */
  startRefresh(): void {
    if (this.disposed || this.startupTimer) return;
    this.startupTimer = setTimeout(() => {
      void this.refreshStale();
    }, this.timings.startupDelayMs);
    this.startupTimer.unref?.();
  }

  /**
   * Checks, one after another, every account last answered more than `staleMs` ago (or
   * never). Failures are logged quietly and never surfaced.
   */
  async refreshStale(): Promise<void> {
    for (const manifest of this.providers.list()) {
      if (this.disposed) return;
      if (manifest.capabilities.account === 'none') continue;
      const last = this.repo.get(manifest.id)?.lastCheckedAt?.getTime();
      if (last !== undefined && this.clock().getTime() - last < this.timings.staleMs) continue;
      try {
        await this.status(manifest.id);
      } catch (error) {
        this.log.debug(`Account ${manifest.id}: startup check failed (${String(error)})`);
      }
    }
  }

  /**
   * On quit: no more checks, timers or writes. Every pending `signIn` settles at once with
   * the stored account. Call it before the database closes and before the windows close.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    for (const probe of this.probes.values()) probe.controller.abort();
    for (const session of [...this.signIns.values()]) {
      const provider = this.providers.get(session.providerId);
      this.settle(session, this.accountOf(provider.manifest));
    }
  }

  // ---------------------------------------------------------------------------------------

  /** The provider, which must have accounts. */
  private accountProvider(providerId: ProviderId): AccommodationProvider {
    const provider = this.providers.get(providerId);
    if (provider.manifest.capabilities.account === 'none' || !provider.auth) {
      throw new ProviderCapabilityError(providerId, 'account');
    }
    return provider;
  }

  /** The provider and its `browser-session` auth; other kinds are not built yet (§12.30). */
  private browserSessionAuth(providerId: ProviderId): {
    provider: AccommodationProvider;
    auth: BrowserSessionAuth;
  } {
    const provider = this.accountProvider(providerId);
    const auth = provider.auth;
    if (auth?.kind !== 'browser-session') {
      throw new AppError(
        'NOT_IMPLEMENTED',
        `Signing in to ${provider.manifest.shortName} in the app is not available yet`
      );
    }
    return { provider, auth };
  }

  private epochOf(providerId: ProviderId): number {
    return this.epochs.get(providerId) ?? 0;
  }

  private async probe(
    provider: AccommodationProvider,
    controller: AbortController
  ): Promise<ProviderAccount> {
    const { manifest } = provider;
    const providerId = manifest.id;
    const epoch = this.epochOf(providerId);
    const timer = setTimeout(() => controller.abort(), this.timings.probeTimeoutMs);
    timer.unref?.();

    let result: AccountStatus;
    try {
      result = await provider.auth!.isSignedIn(
        this.providers.httpOf(providerId),
        controller.signal
      );
    } catch (error) {
      result = {
        state: 'unknown',
        reason: controller.signal.aborted ? 'timeout' : 'error',
      };
      if (!controller.signal.aborted) {
        this.log.debug(`Account ${providerId}: the check failed (${String(error)})`);
      }
    } finally {
      clearTimeout(timer);
    }

    if (this.disposed || epoch !== this.epochOf(providerId)) return this.accountOf(manifest);
    const account = this.record(manifest, result);
    const ttlMs = result.state === 'unknown' ? this.timings.unknownCacheMs : this.timings.cacheMs;
    this.cache.set(providerId, { at: this.clock().getTime(), ttlMs, account });
    return account;
  }

  /** Stores a definite answer; an `unknown` one changes nothing (see the class comment). */
  private record(manifest: Readonly<ProviderManifest>, result: AccountStatus): ProviderAccount {
    const providerId = manifest.id;
    const before = this.repo.get(providerId);
    if (result.state === 'unknown') {
      this.log.debug(`Account ${providerId}: no definite answer (${result.reason ?? 'unknown'})`);
      return this.toAccount(manifest, before);
    }

    const now = this.clock();
    const changes: ProviderAccountUpsert = {
      providerId,
      status: result.state,
      lastCheckedAt: now,
    };
    if (result.state === 'signed-in') {
      if (result.email) changes.email = result.email;
      if (result.displayName) changes.displayName = result.displayName;
      if (before?.status !== 'signed-in') changes.lastSignedInAt = now;
    }
    const after = this.repo.upsert(changes, now);
    const account = this.toAccount(manifest, after);
    if (this.visiblyChanged(before, after)) {
      this.log.info(`Account ${providerId}: ${after.status}`);
      this.events.emit('account:updated', account);
    }
    return account;
  }

  private visiblyChanged(
    before: ProviderAccountRecord | null | undefined,
    after: ProviderAccountRecord
  ): boolean {
    return (
      before?.status !== after.status ||
      before?.email !== after.email ||
      before?.displayName !== after.displayName ||
      before?.lastSignedInAt?.getTime() !== after.lastSignedInAt?.getTime()
    );
  }

  private accountOf(manifest: Readonly<ProviderManifest>): ProviderAccount {
    return this.toAccount(manifest, this.repo.get(manifest.id));
  }

  private toAccount(
    manifest: Readonly<ProviderManifest>,
    record: ProviderAccountRecord | null | undefined
  ): ProviderAccount {
    return {
      providerId: manifest.id,
      requirement: manifest.capabilities.account,
      status: record?.status ?? 'unknown',
      ...(record?.displayName ? { displayName: record.displayName } : {}),
      ...(record?.email ? { email: record.email } : {}),
      ...(record?.lastSignedInAt ? { lastSignedInAt: record.lastSignedInAt.toISOString() } : {}),
      ...(record?.lastCheckedAt ? { lastCheckedAt: record.lastCheckedAt.toISOString() } : {}),
    };
  }

  private startSignIn(
    provider: AccommodationProvider,
    auth: BrowserSessionAuth,
    url: string
  ): SignInSession {
    const { manifest } = provider;
    const window = this.windows.open({
      providerId: manifest.id,
      providerName: manifest.shortName,
      kind: 'sign-in',
      url,
      allowedOrigins: auth.allowedOrigins,
      openBlockedExternally: true,
      ...(provider.access?.waitingRoomOrigins
        ? { waitingRoomOrigins: provider.access.waitingRoomOrigins }
        : {}),
    });
    let resolve!: (account: ProviderAccount) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<ProviderAccount>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    // A pasted link's sign-in has no caller waiting on it
    promise.catch(() => undefined);
    const session: SignInSession = {
      providerId: manifest.id,
      window,
      promise,
      resolve,
      reject,
      settled: false,
    };
    this.signIns.set(manifest.id, session);
    this.log.info(`Account ${manifest.id}: sign-in window opened`);

    const completion = auth.completionUrlPatterns ?? [];
    window.onNavigate(({ url: page }) => {
      if (completion.length && matchesUrlPattern(page, completion)) {
        void this.confirmSignIn(session, provider);
      }
    });
    window.onClosed((failure) => {
      if (failure) this.fail(session, failure);
      else void this.finishOnClose(session, provider);
    });
    this.schedulePoll(session, provider, new URL(auth.signInUrl).origin);
    return session;
  }

  private schedulePoll(
    session: SignInSession,
    provider: AccommodationProvider,
    siteOrigin: string
  ): void {
    if (session.settled || this.disposed) return;
    session.pollTimer = setTimeout(() => {
      void (async () => {
        if (session.settled || this.disposed) return;
        if (matchesOrigin(session.window.currentUrl(), [siteOrigin])) {
          await this.confirmSignIn(session, provider);
        }
        this.schedulePoll(session, provider, siteOrigin);
      })();
    }, this.timings.pollMs);
    session.pollTimer.unref?.();
  }

  /** Checks now; on signed in, settles the sign-in and closes its window. */
  private async confirmSignIn(
    session: SignInSession,
    provider: AccommodationProvider
  ): Promise<void> {
    let account: ProviderAccount;
    try {
      account = await this.status(provider.manifest.id, { force: true });
    } catch {
      return;
    }
    if (session.settled || account.status !== 'signed-in') return;
    // Settled first, so closing the window does not check again; the caller hears once the
    // window is closed and the cookies are on disk.
    session.settled = true;
    if (session.pollTimer) clearTimeout(session.pollTimer);
    if (this.signIns.get(session.providerId) === session) this.signIns.delete(session.providerId);
    session.window.close();
    await this.flush(provider.manifest.id);
    this.log.info(`Account ${provider.manifest.id}: signed in`);
    session.resolve(account);
  }

  private async finishOnClose(
    session: SignInSession,
    provider: AccommodationProvider
  ): Promise<void> {
    if (session.settled) return;
    if (session.pollTimer) clearTimeout(session.pollTimer);
    let account: ProviderAccount;
    try {
      account = this.disposed
        ? this.accountOf(provider.manifest)
        : await this.status(provider.manifest.id);
    } catch {
      account = this.accountOf(provider.manifest);
    }
    this.settle(session, account);
  }

  private settle(session: SignInSession, account: ProviderAccount): void {
    if (!this.end(session)) return;
    session.resolve(account);
  }

  /** The sign-in window closed itself: its first page was blocked or failed to load. */
  private fail(session: SignInSession, failure: Error): void {
    if (!this.end(session)) return;
    this.log.warn(`Account ${session.providerId}: the sign-in window could not open its page`);
    session.reject(failure);
  }

  /** Marks the session settled (once); false when it already was. */
  private end(session: SignInSession): boolean {
    if (session.settled) return false;
    session.settled = true;
    if (session.pollTimer) clearTimeout(session.pollTimer);
    if (this.signIns.get(session.providerId) === session) this.signIns.delete(session.providerId);
    return true;
  }

  private async flush(providerId: ProviderId): Promise<void> {
    try {
      await this.sessions.flush(providerId);
    } catch (error) {
      this.log.warn(
        `Account ${providerId}: could not write its cookies to disk (${String(error)})`
      );
    }
  }
}
