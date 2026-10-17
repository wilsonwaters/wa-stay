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
 *
 * **`credentials` accounts** (§12.35; brief R5, RO4): the person saves the details the provider
 * asks for (`CredentialsAuth.fields`) in Settings → Accounts.
 * - `saveCredentials(id, values, confirmed)` needs every declared field (trimmed, not empty, at
 *   most 256 characters) and every confirmation ticked (`VALIDATION`, with `values.<key>` or
 *   `confirmed`), then asks the provider's `signIn` (15 s, at interactive priority). Only a
 *   `signed-in` answer stores the values, each as `account.<key>` in the provider's scoped
 *   secret vault (`registry.secretsOf`), all or nothing. Saving again replaces them; saves and
 *   removals for a provider run one after another.
 * - The status is worked out from what is stored: signed in when every field has a readable
 *   value. `isSignedIn` is never called and no request is made; `refreshStale` skips them.
 * - `signOut(id)` deletes the values and stores `signed-out`: no session to clear, never
 *   `ACCOUNT_BUSY`.
 * - `copyCredential(id, key)` writes a saved, `copyable` value to the clipboard from main.
 * - `onCredentialsChanged(id)` runs after each save and removal.
 * A value is never logged, never put in an error message, and never returned: an account
 * carries the field descriptors and `savedFields` (key names) only. The sign-in window
 * (`signIn`, `openSignInLink`) stays `NOT_IMPLEMENTED` for them.
 */

import type { EventSink } from '@shared/contracts/events';
import {
  ACCOUNT_VALUE_MAX_LENGTH,
  type AccountStatus,
  type ProviderAccount,
  type ProviderId,
  type ProviderManifest,
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
import { withRequestPriority } from '../../providers/sdk/pacing';
import type {
  AccommodationProvider,
  BrowserSessionAuth,
  CredentialsAuth,
  CredentialsSignInResult,
} from '../../providers/sdk/provider';
import { matchesOrigin, matchesUrlPattern } from '../../providers/sdk/url-patterns';
import { AppError } from '../../utils/app-error';
import type {
  AccountGate,
  Clipboard,
  ProviderSessionStore,
  ProviderWindowHandle,
  ProviderWindowOpener,
} from './ports';

export interface AccountTimings {
  /** How long a check's definite answer is reused. */
  cacheMs: number;
  /** How long an answer that was not definite (`unknown`) is reused. */
  unknownCacheMs: number;
  /** The most a check may take: `isSignedIn`, or a `credentials` sign-in's `signIn`. */
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
  providers: Pick<ProviderRegistry, 'get' | 'list' | 'httpOf' | 'secretsOf'>;
  accounts: Pick<ProviderAccountRepository, 'get' | 'upsert'>;
  windows: ProviderWindowOpener;
  sessions: ProviderSessionStore;
  /** Where `copyCredential` writes a saved value. */
  clipboard: Clipboard;
  events: EventSink;
  /**
   * True while the provider's session holds something a sign-out would lose at `now` (the
   * service's clock): a queue place, a hold being placed, or a hold waiting for payment.
   */
  isBusy(providerId: ProviderId, now: Date): boolean;
  /**
   * Runs after a `credentials` account's values are saved, replaced or removed, with the
   * provider id only (R16: drop its availability caches and re-arm its snipes). A failure is
   * logged and never fails the save.
   */
  onCredentialsChanged?(providerId: ProviderId): void;
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

/** Where a `credentials` field's value is kept in the provider's scoped secret vault. */
export const credentialKey = (fieldKey: string): string => `account.${fieldKey}`;

/** An error's name, never its message: a message may quote what was typed. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export class ProviderAccountService implements AccountGate {
  private readonly providers: ProviderAccountServiceDeps['providers'];
  private readonly repo: ProviderAccountServiceDeps['accounts'];
  private readonly windows: ProviderWindowOpener;
  private readonly sessions: ProviderSessionStore;
  private readonly clipboard: Clipboard;
  private readonly events: EventSink;
  private readonly isBusy: (providerId: ProviderId, now: Date) => boolean;
  private readonly onCredentialsChanged?: (providerId: ProviderId) => void;
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
  /** Each provider's last `credentials` save or removal: the next one waits for it. */
  private readonly credentialQueues = new Map<ProviderId, Promise<void>>();
  /** `<providerId>:<key>` of saved values that could not be read, warned about once. */
  private readonly unreadable = new Set<string>();
  private startupTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(deps: ProviderAccountServiceDeps) {
    this.providers = deps.providers;
    this.repo = deps.accounts;
    this.windows = deps.windows;
    this.sessions = deps.sessions;
    this.clipboard = deps.clipboard;
    this.events = deps.events;
    this.isBusy = deps.isBusy;
    this.onCredentialsChanged = deps.onCredentialsChanged;
    this.log = deps.logger.child({ module: 'accounts' });
    this.clock = deps.clock ?? (() => new Date());
    this.timings = { ...DEFAULT_ACCOUNT_TIMINGS, ...deps.timings };
  }

  /**
   * An account for every provider that has sign-in, from the stored rows (and, for
   * `credentials`, from what the vault holds). No network.
   */
  async list(): Promise<ProviderAccount[]> {
    const accounts: ProviderAccount[] = [];
    for (const manifest of this.providers.list()) {
      if (manifest.capabilities.account === 'none') continue;
      const provider = this.providers.get(manifest.id);
      const auth = provider.auth;
      accounts.push(
        auth?.kind === 'credentials'
          ? await this.credentialsAccount(provider, auth)
          : this.toAccount(manifest, this.repo.get(manifest.id))
      );
    }
    return accounts;
  }

  /** The stored (last definite) state. Synchronous; no network. */
  storedState(providerId: ProviderId): ProviderAccountState {
    return this.repo.get(providerId)?.status ?? 'unknown';
  }

  /** Asks the provider whether its session is signed in (see the class comment). */
  status(providerId: ProviderId, options: { force?: boolean } = {}): Promise<ProviderAccount> {
    const provider = this.accountProvider(providerId);
    if (provider.auth?.kind === 'credentials')
      return this.credentialsStatus(provider, provider.auth);
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

  /** Signs out, or for `credentials` removes the saved values (see the class comment). */
  async signOut(providerId: ProviderId): Promise<ProviderAccount> {
    const provider = this.accountProvider(providerId);
    const { manifest } = provider;
    const auth = provider.auth;
    if (auth?.kind === 'credentials') {
      return this.serially(providerId, () => this.removeCredentials(provider, auth));
    }
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
   * Saves a `credentials` account's values once the person confirmed each statement and the
   * provider's `signIn` accepted them (see the class comment). Replaces any saved values.
   * `VALIDATION` for a provider that uses another sign-in, for missing, unknown, empty or
   * too long values (`values.<key>`), for an unticked statement (`confirmed`) and when the
   * provider refuses them; `PROVIDER_ERROR` when it could not tell; `INTERNAL` when they could
   * not be stored (nothing is). No message quotes a value.
   */
  async saveCredentials(
    providerId: ProviderId,
    values: Readonly<Record<string, string>>,
    confirmed: readonly string[]
  ): Promise<ProviderAccount> {
    const { provider, auth } = this.credentialsAuth(providerId);
    const checked = checkCredentials(provider.manifest, auth, values, confirmed);
    return this.serially(providerId, () => this.storeCredentials(provider, auth, checked));
  }

  /**
   * Writes a saved `credentials` value to the clipboard, from main: the renderer never gets it.
   * The field must be declared and `copyable` (`VALIDATION`) and saved (`NOT_FOUND`).
   */
  async copyCredential(providerId: ProviderId, key: string): Promise<void> {
    const { provider, auth } = this.credentialsAuth(providerId);
    const field = auth.fields.find((f) => f.key === key);
    if (!field) {
      throw new AppError('VALIDATION', `${provider.manifest.shortName} has no such detail`, {
        issues: ['key'],
      });
    }
    if (!field.copyable) {
      throw new AppError('VALIDATION', `${field.label} can't be copied`, { issues: ['key'] });
    }
    let value: string | undefined;
    try {
      value = await this.providers.secretsOf(providerId).get(credentialKey(key));
    } catch {
      this.warnUnreadable(providerId, key);
      throw new AppError('INTERNAL', `Couldn't read your saved ${field.label}. Add it again.`);
    }
    if (!value) throw new AppError('NOT_FOUND', `No ${field.label} is saved`);
    this.clipboard.writeText(value);
    this.log.info(`Account ${providerId}: ${key} copied to the clipboard`);
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
      // Worked out from the vault whenever it is asked: nothing to refresh
      if (this.providers.get(manifest.id).auth?.kind === 'credentials') continue;
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

  /**
   * The provider and its `browser-session` auth. A `credentials` account has no window (the
   * renderer saves its details instead); `automation` is not built yet (§12.30).
   */
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

  /** The provider and its `credentials` auth; `VALIDATION` for another kind. */
  private credentialsAuth(providerId: ProviderId): {
    provider: AccommodationProvider;
    auth: CredentialsAuth;
  } {
    const provider = this.accountProvider(providerId);
    const auth = provider.auth;
    if (auth?.kind !== 'credentials') {
      throw new AppError('VALIDATION', `${provider.manifest.shortName} doesn't use saved details`, {
        issues: ['providerId'],
      });
    }
    return { provider, auth };
  }

  /** Runs `task` once every earlier save or removal for the provider has settled. */
  private serially<T>(providerId: ProviderId, task: () => Promise<T>): Promise<T> {
    const previous = this.credentialQueues.get(providerId) ?? Promise.resolve();
    const run = previous.then(task);
    const settled = run.then(
      () => undefined,
      () => undefined
    );
    this.credentialQueues.set(providerId, settled);
    void settled.then(() => {
      if (this.credentialQueues.get(providerId) === settled)
        this.credentialQueues.delete(providerId);
    });
    return run;
  }

  private async storeCredentials(
    provider: AccommodationProvider,
    auth: CredentialsAuth,
    values: Readonly<Record<string, string>>
  ): Promise<ProviderAccount> {
    const { manifest } = provider;
    const providerId = manifest.id;
    const answer = await this.askProvider(provider, auth, values);
    if (answer.state === 'signed-out') {
      throw new AppError('VALIDATION', `${manifest.shortName} didn't accept these details`, {
        issues: auth.fields.map((field) => `values.${field.key}`),
      });
    }
    if (answer.state !== 'signed-in') {
      throw new AppError('PROVIDER_ERROR', "Couldn't check these details. Try again.");
    }
    if (this.disposed) throw new AppError('INTERNAL', 'WA Stay is closing; nothing was saved.');
    let toStore = normalisedValues(auth, values, answer.values);
    if (!toStore) {
      this.log.warn(
        `Account ${providerId}: its normalised values were ignored (an undeclared key, or a value that is not text, empty or too long); the typed ones are kept`
      );
      toStore = values;
    }

    const secrets = this.providers.secretsOf(providerId);
    let written = 0;
    try {
      for (const field of auth.fields) {
        await secrets.set(credentialKey(field.key), toStore[field.key]);
        written++;
      }
    } catch (error) {
      this.log.warn(`Account ${providerId}: the details could not be stored (${errorName(error)})`);
      // Some values were already replaced: none of the set is kept, so no half of one is used
      if (written > 0) await this.forgetCredentials(provider, auth).catch(() => undefined);
      throw new AppError('INTERNAL', "Couldn't save your details on this computer. Try again.");
    }

    const now = this.clock();
    const after = this.repo.upsert(
      { providerId, status: 'signed-in', lastCheckedAt: now, lastSignedInAt: now },
      now
    );
    this.clearUnreadable(providerId);
    const saved = auth.fields.map((field) => field.key);
    const account = this.toCredentialsAccount(manifest, auth, after, 'signed-in', saved);
    this.log.info(`Account ${providerId}: details saved`);
    this.events.emit('account:updated', account);
    this.credentialsChanged(providerId);
    return account;
  }

  /** The provider's `signIn` answer for the values, within the probe limit, or `unknown`. */
  private async askProvider(
    provider: AccommodationProvider,
    auth: CredentialsAuth,
    values: Readonly<Record<string, string>>
  ): Promise<CredentialsSignInResult> {
    const providerId = provider.manifest.id;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Bounded even when the provider ignores its signal
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('timeout'));
      }, this.timings.probeTimeoutMs);
      timer.unref?.();
    });
    try {
      // The person is waiting: any request it makes goes ahead of background work
      const answer = await Promise.race([
        withRequestPriority('interactive', () =>
          auth.signIn({ ...values }, this.providers.httpOf(providerId), controller.signal)
        ),
        timedOut,
      ]);
      return answer?.state ? answer : { state: 'unknown' };
    } catch (error) {
      this.log.debug(
        `Account ${providerId}: the details could not be checked (${errorName(error)})`
      );
      return { state: 'unknown' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Deletes the saved values and stores `signed-out` (never refused: no session to lose). */
  private async removeCredentials(
    provider: AccommodationProvider,
    auth: CredentialsAuth
  ): Promise<ProviderAccount> {
    const account = await this.forgetCredentials(provider, auth);
    this.log.info(`Account ${provider.manifest.id}: saved details removed`);
    return account;
  }

  /** Deletes every `account.<key>`, stores `signed-out`, announces it and runs the hook. */
  private async forgetCredentials(
    provider: AccommodationProvider,
    auth: CredentialsAuth
  ): Promise<ProviderAccount> {
    const { manifest } = provider;
    const providerId = manifest.id;
    const secrets = this.providers.secretsOf(providerId);
    for (const field of auth.fields) await secrets.delete(credentialKey(field.key));
    this.clearUnreadable(providerId);
    const now = this.clock();
    const after = this.repo.upsert({ providerId, status: 'signed-out', lastCheckedAt: now }, now);
    const account = this.toCredentialsAccount(manifest, auth, after, 'signed-out', []);
    this.events.emit('account:updated', account);
    this.credentialsChanged(providerId);
    return account;
  }

  private credentialsChanged(providerId: ProviderId): void {
    const failed = (error: unknown) =>
      this.log.warn(`Account ${providerId}: the change hook failed (${errorName(error)})`);
    try {
      const result: unknown = this.onCredentialsChanged?.(providerId);
      if (result instanceof Promise) result.catch(failed);
    } catch (error) {
      failed(error);
    }
  }

  /** The keys of the fields whose value is stored and readable. No network. */
  private async savedFields(providerId: ProviderId, auth: CredentialsAuth): Promise<string[]> {
    const secrets = this.providers.secretsOf(providerId);
    const saved: string[] = [];
    for (const field of auth.fields) {
      try {
        if (await secrets.get(credentialKey(field.key))) saved.push(field.key);
      } catch {
        this.warnUnreadable(providerId, field.key);
      }
    }
    return saved;
  }

  /** Once per value (until it is saved or removed again), naming its key only. */
  private warnUnreadable(providerId: ProviderId, key: string): void {
    const id = `${providerId}:${key}`;
    if (this.unreadable.has(id)) return;
    this.unreadable.add(id);
    this.log.warn(`Account ${providerId}: the saved ${key} can't be read; it counts as not saved`);
  }

  private clearUnreadable(providerId: ProviderId): void {
    for (const id of [...this.unreadable]) {
      if (id.startsWith(`${providerId}:`)) this.unreadable.delete(id);
    }
  }

  /** A `credentials` account as stored: signed in when every field has a readable value. */
  private async credentialsAccount(
    provider: AccommodationProvider,
    auth: CredentialsAuth
  ): Promise<ProviderAccount> {
    const { manifest } = provider;
    const saved = await this.savedFields(manifest.id, auth);
    const status = saved.length === auth.fields.length ? 'signed-in' : 'signed-out';
    return this.toCredentialsAccount(manifest, auth, this.repo.get(manifest.id), status, saved);
  }

  /**
   * `status` for a `credentials` account: no request. When the vault and the stored row
   * disagree (a value became unreadable), the row follows the vault, once.
   */
  private async credentialsStatus(
    provider: AccommodationProvider,
    auth: CredentialsAuth
  ): Promise<ProviderAccount> {
    const account = await this.credentialsAccount(provider, auth);
    const providerId = provider.manifest.id;
    const signedIn = account.status === 'signed-in';
    if (this.disposed || (this.repo.get(providerId)?.status === 'signed-in') === signedIn) {
      return account;
    }
    const now = this.clock();
    const after = this.repo.upsert(
      {
        providerId,
        status: signedIn ? 'signed-in' : 'signed-out',
        lastCheckedAt: now,
        ...(signedIn ? { lastSignedInAt: now } : {}),
      },
      now
    );
    const recorded = this.toCredentialsAccount(
      provider.manifest,
      auth,
      after,
      account.status,
      account.savedFields ?? []
    );
    this.log.info(`Account ${providerId}: ${recorded.status}`);
    this.events.emit('account:updated', recorded);
    return recorded;
  }

  private toCredentialsAccount(
    manifest: Readonly<ProviderManifest>,
    auth: CredentialsAuth,
    record: ProviderAccountRecord | null | undefined,
    status: ProviderAccount['status'],
    saved: readonly string[]
  ): ProviderAccount {
    return {
      ...this.toAccount(manifest, record),
      status,
      // Picked field by field: nothing else a provider put on a descriptor crosses to the renderer
      fields: auth.fields.map(({ key, label, help, secret, copyable }) => ({
        key,
        label,
        ...(help ? { help } : {}),
        secret,
        ...(copyable ? { copyable: true } : {}),
      })),
      confirmations: (auth.confirmations ?? []).map(({ key, label }) => ({ key, label })),
      savedFields: [...saved],
    };
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
      authKind: this.providers.get(manifest.id).auth?.kind ?? 'browser-session',
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

/**
 * The values to store: every declared field, trimmed (spaces and dashes inside are the
 * provider's to reformat in `signIn`), not empty and at most `ACCOUNT_VALUE_MAX_LENGTH`
 * characters; no undeclared key; every confirmation ticked. Otherwise `VALIDATION`, with the
 * paths at fault (`values.<key>`, `confirmed`) and a message that never quotes a value.
 */
function checkCredentials(
  manifest: Readonly<ProviderManifest>,
  auth: CredentialsAuth,
  values: Readonly<Record<string, string>>,
  confirmed: readonly string[]
): Record<string, string> {
  const issues: string[] = [];
  let message: string | undefined;
  const fail = (path: string, text: string) => {
    issues.push(path);
    message ??= text;
  };

  const checked: Record<string, string> = {};
  for (const field of auth.fields) {
    const raw: unknown = Object.hasOwn(values, field.key) ? values[field.key] : undefined;
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) fail(`values.${field.key}`, `${field.label} is missing`);
    else if ([...value].length > ACCOUNT_VALUE_MAX_LENGTH) {
      fail(
        `values.${field.key}`,
        `${field.label} is too long (${ACCOUNT_VALUE_MAX_LENGTH} characters at most)`
      );
    } else checked[field.key] = value;
  }
  for (const key of Object.keys(values)) {
    if (!auth.fields.some((field) => field.key === key)) {
      fail(`values.${key}`, `${manifest.shortName} doesn't ask for that detail`);
    }
  }
  const ticked = new Set(confirmed);
  if ((auth.confirmations ?? []).some((confirmation) => !ticked.has(confirmation.key))) {
    fail('confirmed', 'Tick each statement to save');
  }

  if (issues.length) throw new AppError('VALIDATION', message, { issues });
  return checked;
}

/**
 * The values to store: the typed ones, with any the provider's `signIn` returned in their
 * place (`CredentialsSignInResult.values`), or null when what it returned breaks the rules
 * (an undeclared key, or a value that is not text, empty or over `ACCOUNT_VALUE_MAX_LENGTH`
 * characters once trimmed).
 */
function normalisedValues(
  auth: CredentialsAuth,
  typed: Readonly<Record<string, string>>,
  returned: unknown
): Record<string, string> | null {
  if (returned === undefined) return { ...typed };
  if (typeof returned !== 'object' || returned === null || Array.isArray(returned)) return null;
  const values: Record<string, string> = { ...typed };
  for (const [key, raw] of Object.entries(returned)) {
    if (!auth.fields.some((field) => field.key === key) || typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value || [...value].length > ACCOUNT_VALUE_MAX_LENGTH) return null;
    values[key] = value;
  }
  return values;
}
