/**
 * `PlaywrightBrowserAutomation`: the `BrowserAutomation` behind `ProviderContext.browser`
 * (brief D5, architecture-notes §3 and §10). It drives the Microsoft Edge or Google Chrome
 * already installed on the computer through `playwright-core`. No browser is bundled or
 * downloaded.
 *
 * - **Lazy.** `playwright-core` is imported on first use, so app start-up, and providers that
 *   never automate, pay nothing for it. Every type import below is erased.
 * - **Detection.** Channels are tried in platform order: Edge, then Chrome on Windows (Edge is
 *   on every Windows 10/11 machine); Chrome, then Edge elsewhere. A "not found" or "not
 *   supported" answer moves on to the next one. The channel that works is remembered in the
 *   provider's state (`browser.channel`) and tried first next time. `executablePath`
 *   replaces detection, for development only.
 * - **Sandboxed.** Playwright starts Chromium with `--no-sandbox` unless it is asked not to.
 *   The person's own Edge or Chrome browses third-party sites, so it always keeps Chromium's
 *   sandbox (`chromiumSandbox: true`). Only a development `executablePath` keeps Playwright's
 *   default, because it often runs as root (CI, containers), where a sandbox cannot start.
 * - **One persistent context per provider**, with its profile in
 *   `<userData>/providers/<id>/browser`, so the provider's own cookies and sign-in survive
 *   between runs. Chromium locks a profile, so `withPage` calls are serialised.
 * - **Headless by default.** `headed: true` shows a window for a step a person must do. The
 *   context is relaunched when the mode changes, and a headed window closes when its call
 *   ends (Chromium quits with its last window anyway).
 * - **Lifecycle.** The context closes after 5 minutes without a call. `close()` gives it 5 s
 *   to close, then kills the browser process, unless the browser has already exited (its
 *   process id may since belong to another process). A context that crashes or disconnects
 *   is dropped, and the next call relaunches it.
 */

import { spawnSync } from 'child_process';
import type { BrowserContext, BrowserType, LaunchOptions, Page } from 'playwright-core';
import type { ProviderId } from '@shared/types/provider.types';
import type { BrowserAutomation, BrowserAvailability, WithPageOptions } from './browser';
import { createLimiter, type Limiter } from './concurrency';
import type { ProviderLogger } from './context';
import {
  BrowserUnavailableError,
  createAbortError,
  isAbortError,
  type BrowserUnavailableReason,
} from './errors';
import type { KeyValueStore } from './kv-store';

/** The installed-browser channels WA Stay automates. */
export type BrowserChannel = 'msedge' | 'chrome';

/** The channel reported when `executablePath` replaces detection. */
export const CUSTOM_BROWSER_CHANNEL = 'custom';

/** The provider-state key that remembers the channel that worked. */
export const BROWSER_CHANNEL_KEY = 'browser.channel';

export const DEFAULT_PAGE_TIMEOUT_MS = 60_000;
/** An unused context closes after this long. */
export const BROWSER_IDLE_CLOSE_MS = 5 * 60_000;
/** `close()` waits this long for the context, then kills the browser. */
export const BROWSER_CLOSE_TIMEOUT_MS = 5_000;
/** The longest the Windows kill (`taskkill`) may block the main process. */
export const BROWSER_KILL_TIMEOUT_MS = 2_000;
export const BROWSER_LAUNCH_TIMEOUT_MS = 30_000;
/** A locked profile is tried once more after this long. */
export const PROFILE_LOCK_RETRY_MS = 1_000;

const VIEWPORT = Object.freeze({ width: 1280, height: 800 });
const LOCALE = 'en-AU';

/** Windows: Edge first (always installed). Elsewhere: Chrome first. */
export function channelOrder(platform: NodeJS.Platform): BrowserChannel[] {
  return platform === 'win32' ? ['msedge', 'chrome'] : ['chrome', 'msedge'];
}

export interface PlaywrightBrowserAutomationOptions {
  providerId: ProviderId;
  /** Names the provider in messages people read (`manifest.name`). Defaults to the id. */
  providerName?: string;
  /** The provider's persistent profile, `<userData>/providers/<id>/browser`. Absolute. */
  userDataDir: string;
  logger: ProviderLogger;
  /** The provider's state, where the working channel is remembered. */
  state: KeyValueStore;
  /** The IANA zone pages see (`manifest.timezone`). */
  timezoneId?: string;
  /** Development only: automate this executable instead of detecting Edge or Chrome. */
  executablePath?: string;
  /** Picks the channel order and how a hung browser is killed. Default `process.platform`. */
  platform?: NodeJS.Platform;
}

/** The part of `playwright-core` this module uses. */
interface PlaywrightModule {
  chromium: BrowserType;
}

interface LaunchCandidate {
  channel: string;
  options: Pick<LaunchOptions, 'channel' | 'executablePath' | 'chromiumSandbox'>;
}

interface Session {
  readonly context: BrowserContext;
  readonly headless: boolean;
  readonly channel: string;
  /** The browser's process id, for the kill path. */
  pid?: number;
  /** `closing` once we close it; `gone` when it closed by itself (crash, update, disconnect). */
  state: 'open' | 'closing' | 'gone';
  /**
   * The browser has gone: the context closed or the browser disconnected, whoever caused it.
   * Its process id may be reused from then on, so it is never killed.
   */
  exited: boolean;
  closed?: Promise<void>;
}

/** Playwright's answer when a channel is not installed, or not made for this platform. */
const BROWSER_MISSING =
  /Chromium distribution '[^']+' is not (found|supported)|executable doesn't exist at/;
/** Chromium's answer when another process holds the profile (Playwright rewrites it to this). */
const PROFILE_LOCKED = /ProcessSingleton/;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : '');

const MESSAGES: Record<BrowserUnavailableReason, (provider: string) => string> = {
  'no-browser': (provider) =>
    `WA Stay needs Microsoft Edge or Google Chrome installed to use ${provider}`,
  'runtime-missing': (provider) =>
    `WA Stay's browser automation is missing from this installation, so it cannot use ${provider}. Reinstalling WA Stay should fix this.`,
  'profile-locked': (provider) =>
    `The browser profile WA Stay keeps for ${provider} is in use by another browser window. Close it and try again.`,
  'launch-failed': (provider) =>
    `The browser WA Stay uses for ${provider} did not start. Try again later.`,
  closing: () => 'WA Stay is closing',
};

/** Rejects with an `AbortError` as soon as `signal` aborts, whatever `promise` is doing. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(createAbortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class PlaywrightBrowserAutomation implements BrowserAutomation {
  readonly providerId: ProviderId;
  readonly userDataDir: string;
  private readonly providerName: string;
  private readonly logger: ProviderLogger;
  private readonly state: KeyValueStore;
  private readonly timezoneId?: string;
  private readonly executablePath?: string;
  private readonly platform: NodeJS.Platform;
  /** Serialises `withPage` and the idle close: one page at a time per provider. */
  private readonly mutex: Limiter = createLimiter(1);
  private playwright?: Promise<PlaywrightModule>;
  private session: Session | null = null;
  private availability?: Promise<BrowserAvailability>;
  private rememberedChannel?: string;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private closing?: Promise<void>;

  constructor(options: PlaywrightBrowserAutomationOptions) {
    this.providerId = options.providerId;
    this.providerName = options.providerName ?? options.providerId;
    this.userDataDir = options.userDataDir;
    this.logger = options.logger;
    this.state = options.state;
    this.timezoneId = options.timezoneId;
    this.executablePath = options.executablePath || undefined;
    this.platform = options.platform ?? process.platform;
  }

  /**
   * Whether a browser can be automated. Answers from the open context, or from what the last
   * launch found; otherwise it probes each channel with a throwaway headless browser (never
   * the provider's profile) and closes it. A definitive answer is kept for the session; a
   * `launch-failed` probe is not, so the next call probes again.
   */
  async isAvailable(): Promise<BrowserAvailability> {
    if (this.closing) return { available: false, reason: 'closing' };
    if (this.session) return { available: true, channel: this.session.channel };
    if (!this.availability) {
      const probing = this.probe().then((answer) => {
        if (
          !answer.available &&
          answer.reason === 'launch-failed' &&
          this.availability === probing
        ) {
          this.availability = undefined;
        }
        return answer;
      });
      this.availability = probing;
    }
    return this.availability;
  }

  /**
   * Runs `fn` on a fresh page of the provider's context, launching the context if needed, and
   * then closes every page the call opened, also when `fn` throws. Calls run one at a time.
   * An abort rejects straight away with an `AbortError` and closes the page, which makes
   * whatever `fn` is waiting on in the page fail.
   */
  withPage<T>(fn: (page: Page) => Promise<T>, options: WithPageOptions = {}): Promise<T> {
    const { signal } = options;
    if (this.closing) return Promise.reject(this.unavailable('closing'));
    if (signal?.aborted) return Promise.reject(createAbortError(signal));
    const run = this.mutex(() => this.runWithPage(fn, options));
    return signal ? raceAbort(run, signal) : run;
  }

  /**
   * Closes the context: waits at most 5 s, then kills the browser process. Later `withPage`
   * calls reject with `BrowserUnavailableError('closing')`. Never rejects.
   */
  close(): Promise<void> {
    this.closing ??= this.shutdown();
    return this.closing;
  }

  // ---------------------------------------------------------------------------------------
  // withPage
  // ---------------------------------------------------------------------------------------

  private async runWithPage<T>(
    fn: (page: Page) => Promise<T>,
    { headed = false, timeoutMs = DEFAULT_PAGE_TIMEOUT_MS, signal }: WithPageOptions
  ): Promise<T> {
    this.clearIdleTimer();
    let session: Session | undefined;
    const onAbort = (): void => {
      if (session) void this.closePages(session);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      this.assertUsable(signal);
      session = await this.ensureSession(!headed);
      this.assertUsable(signal);
      // A fresh context has one blank page; use it rather than open a second window.
      const page = session.context.pages()[0] ?? (await session.context.newPage());
      page.setDefaultTimeout(timeoutMs);
      page.setDefaultNavigationTimeout(timeoutMs);
      return await fn(page);
    } catch (error) {
      if (this.closing && !(error instanceof BrowserUnavailableError) && !isAbortError(error)) {
        throw this.unavailable('closing', error);
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (session) {
        // Every page, also popups `fn` opened, and a blank page an aborted call never used.
        await this.closePages(session);
        // A headed window closes when its step is done.
        if (!session.headless) await this.endSession(session);
      }
      this.armIdleTimer();
    }
  }

  private assertUsable(signal?: AbortSignal): void {
    if (this.closing) throw this.unavailable('closing');
    if (signal?.aborted) throw createAbortError(signal);
  }

  private async closePages(session: Session): Promise<void> {
    await Promise.all(session.context.pages().map((page) => page.close().catch(() => undefined)));
  }

  /** The open context in the requested mode, relaunching it when the mode differs. */
  private async ensureSession(headless: boolean): Promise<Session> {
    const current = this.session;
    if (current?.headless === headless) return current;
    if (current) {
      this.logger.info(`Relaunching the browser ${headless ? 'headless' : 'headed'}`);
      await this.endSession(current);
    }
    const session = await this.launch(headless);
    if (this.closing) {
      await this.endSession(session);
      throw this.unavailable('closing');
    }
    this.session = session;
    return session;
  }

  // ---------------------------------------------------------------------------------------
  // Launch and detection
  // ---------------------------------------------------------------------------------------

  private loadPlaywright(): Promise<PlaywrightModule> {
    this.playwright ??= import('playwright-core').catch((error: unknown) => {
      this.logger.error('playwright-core could not be loaded', error);
      this.availability = Promise.resolve({ available: false, reason: 'runtime-missing' });
      throw this.unavailable('runtime-missing', error);
    });
    return this.playwright;
  }

  /** Launch candidates in the order to try them: the remembered channel first. */
  private async candidates(): Promise<LaunchCandidate[]> {
    if (this.executablePath) {
      return [
        { channel: CUSTOM_BROWSER_CHANNEL, options: { executablePath: this.executablePath } },
      ];
    }
    this.rememberedChannel ??= await this.state
      .get<string>(BROWSER_CHANNEL_KEY)
      .catch(() => undefined);
    const order = channelOrder(this.platform);
    const first = order.find((channel) => channel === this.rememberedChannel);
    const sorted = first ? [first, ...order.filter((channel) => channel !== first)] : order;
    // The installed Edge or Chrome visits third-party sites: keep Chromium's sandbox on.
    return sorted.map((channel) => ({ channel, options: { channel, chromiumSandbox: true } }));
  }

  private async rememberChannel(channel: string): Promise<void> {
    if (channel === CUSTOM_BROWSER_CHANNEL || channel === this.rememberedChannel) return;
    this.rememberedChannel = channel;
    await this.state.set(BROWSER_CHANNEL_KEY, channel).catch((error: unknown) => {
      this.logger.warn('Could not remember the browser channel', error);
    });
  }

  private launchOptions(headless: boolean): LaunchOptions {
    return {
      headless,
      timeout: BROWSER_LAUNCH_TIMEOUT_MS,
      // The app's own quit path closes the browser; Playwright must not exit the process.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    };
  }

  private async launch(headless: boolean): Promise<Session> {
    const { chromium } = await this.loadPlaywright();
    const tried: string[] = [];
    for (const candidate of await this.candidates()) {
      let context: BrowserContext;
      try {
        context = await this.launchContext(chromium, candidate, headless);
      } catch (error) {
        if (BROWSER_MISSING.test(messageOf(error))) {
          tried.push(candidate.channel);
          this.logger.debug(`Browser channel ${candidate.channel} is not installed`);
          continue;
        }
        if (error instanceof BrowserUnavailableError) throw error;
        this.logger.error(`The browser (${candidate.channel}) failed to start`, error);
        throw this.unavailable('launch-failed', error);
      }
      await this.rememberChannel(candidate.channel);
      this.availability = Promise.resolve({ available: true, channel: candidate.channel });
      return this.adopt(context, headless, candidate.channel);
    }
    this.logger.warn(`No browser to automate (tried ${tried.join(', ')})`);
    this.availability = Promise.resolve({ available: false, reason: 'no-browser' });
    throw this.unavailable('no-browser');
  }

  /** Launches the persistent context, retrying once after 1 s when the profile is locked. */
  private async launchContext(
    chromium: BrowserType,
    candidate: LaunchCandidate,
    headless: boolean
  ): Promise<BrowserContext> {
    const options = {
      ...candidate.options,
      ...this.launchOptions(headless),
      viewport: VIEWPORT,
      locale: LOCALE,
      timezoneId: this.timezoneId,
      acceptDownloads: false,
    };
    try {
      return await chromium.launchPersistentContext(this.userDataDir, options);
    } catch (error) {
      if (!PROFILE_LOCKED.test(messageOf(error))) throw error;
      this.logger.warn(`The browser profile ${this.userDataDir} is locked; retrying in 1 s`);
    }
    await delay(PROFILE_LOCK_RETRY_MS);
    try {
      return await chromium.launchPersistentContext(this.userDataDir, options);
    } catch (error) {
      if (!PROFILE_LOCKED.test(messageOf(error))) throw error;
      // Never deleted automatically: it holds the provider's cookies.
      this.logger.error(`The browser profile ${this.userDataDir} is still locked`, error);
      throw this.unavailable('profile-locked', error);
    }
  }

  private async adopt(
    context: BrowserContext,
    headless: boolean,
    channel: string
  ): Promise<Session> {
    const session: Session = { context, headless, channel, state: 'open', exited: false };
    const onExit = (): void => {
      if (session.exited) return;
      // Recorded whatever the state, also while we close it: the kill path must not run now.
      session.exited = true;
      if (session.state !== 'open') return;
      session.state = 'gone';
      if (this.session === session) this.session = null;
      this.clearIdleTimer();
      this.logger.warn('The browser closed by itself (crash, update or disconnect)');
    };
    context.on('close', onExit);
    context.browser()?.on('disconnected', onExit);
    session.pid = await this.findBrowserPid(context);
    this.logger.info(`Browser launched: ${channel}, ${headless ? 'headless' : 'headed'}`);
    return session;
  }

  /**
   * The browser's process id, for the kill path. Playwright does not expose the process of a
   * persistent context, so Chromium is asked (`SystemInfo.getProcessInfo`).
   */
  private async findBrowserPid(context: BrowserContext): Promise<number | undefined> {
    try {
      const cdp = await context.browser()?.newBrowserCDPSession();
      if (!cdp) return undefined;
      const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
      await cdp.detach().catch(() => undefined);
      return processInfo.find((info) => info.type === 'browser')?.id;
    } catch (error) {
      this.logger.warn('Could not read the browser process id', error);
      return undefined;
    }
  }

  private async probe(): Promise<BrowserAvailability> {
    let chromium: BrowserType;
    try {
      ({ chromium } = await this.loadPlaywright());
    } catch {
      return { available: false, reason: 'runtime-missing' };
    }
    for (const candidate of await this.candidates()) {
      try {
        const browser = await chromium.launch({
          ...candidate.options,
          ...this.launchOptions(true),
        });
        await browser.close().catch(() => undefined);
        await this.rememberChannel(candidate.channel);
        return { available: true, channel: candidate.channel };
      } catch (error) {
        if (BROWSER_MISSING.test(messageOf(error))) continue;
        this.logger.warn(`The browser (${candidate.channel}) failed to start`, error);
        return { available: false, reason: 'launch-failed' };
      }
    }
    return { available: false, reason: 'no-browser' };
  }

  // ---------------------------------------------------------------------------------------
  // Closing
  // ---------------------------------------------------------------------------------------

  private armIdleTimer(): void {
    this.clearIdleTimer();
    const session = this.session;
    if (!session || this.closing) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      void this.mutex(async () => {
        if (this.session !== session) return;
        this.logger.info('Closing the browser after 5 minutes without use');
        await this.endSession(session);
      });
    }, BROWSER_IDLE_CLOSE_MS);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private async shutdown(): Promise<void> {
    this.clearIdleTimer();
    const session = this.session;
    if (session) await this.endSession(session);
  }

  /** Closes the session's context once; later calls share the same promise. */
  private endSession(session: Session): Promise<void> {
    if (this.session === session) this.session = null;
    if (session.state === 'open') {
      session.state = 'closing';
      session.closed = this.closeContext(session);
    }
    return session.closed ?? Promise.resolve();
  }

  private async closeContext(session: Session): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), BROWSER_CLOSE_TIMEOUT_MS);
    });
    const closed = session.context.close().then(
      () => true as const,
      (error: unknown) => {
        this.logger.warn('The browser did not close cleanly', error);
        return true as const;
      }
    );
    const inTime = await Promise.race([closed, timedOut]);
    clearTimeout(timer);
    if (inTime) return;
    if (session.exited) {
      // Its process id may since belong to another process (group): never kill it.
      this.logger.warn(
        'The browser exited but its close did not finish within 5 s; not killing it'
      );
      return;
    }
    this.logger.warn(`The browser did not close within 5 s; killing it`);
    this.kill(session);
  }

  private kill({ pid }: Session): void {
    if (pid === undefined) {
      this.logger.error('The browser process id is unknown, so it cannot be killed');
      return;
    }
    try {
      if (this.platform === 'win32') {
        // /T: Chromium's renderer and GPU processes too. Bounded: it blocks the main process.
        const { error } = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
          windowsHide: true,
          timeout: BROWSER_KILL_TIMEOUT_MS,
        });
        if (error) this.logger.warn(`Could not kill browser process ${pid}`, error);
        return;
      }
      try {
        // Playwright starts the browser as a process-group leader, so this kills the group.
        process.kill(-pid, 'SIGKILL');
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    } catch (error) {
      this.logger.warn(`Could not kill browser process ${pid}`, error);
    }
  }

  private unavailable(reason: BrowserUnavailableReason, cause?: unknown): BrowserUnavailableError {
    return new BrowserUnavailableError(
      this.providerId,
      reason,
      MESSAGES[reason](this.providerName),
      cause
    );
  }
}
