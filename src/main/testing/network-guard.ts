/**
 * The network guard of fixture mode (test-only; see `env.ts`).
 *
 * In fixture mode nothing may leave the machine: providers are served by
 * `FixtureHttpClient`, and this guard cancels every http(s) or ws(s) request a Chromium
 * session makes (renderer loads, images, `session.fetch`, `net`), except to the hosts in
 * `WA_STAY_E2E_ALLOW_HOSTS`. It covers `session.defaultSession` and every session created
 * afterwards, which includes each provider's `persist:provider-<id>` partition. Each
 * cancelled request is appended to the unexpected-requests log.
 *
 * Local resources (`file:`, `data:`, `blob:`, `devtools:`) pass untouched.
 */

import { appendUnexpectedRequest } from './request-log';

const NETWORK_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

export interface GuardRequestDetails {
  url: string;
  method: string;
  resourceType?: string;
}

/** The part of an Electron `Session` the guard uses. */
export interface GuardableSession {
  webRequest: {
    onBeforeRequest(
      listener: (
        details: GuardRequestDetails,
        callback: (response: { cancel?: boolean }) => void
      ) => void
    ): void;
  };
}

/** Electron's `app`, which announces every new session. */
export interface SessionSource {
  on(event: 'session-created', listener: (session: GuardableSession) => void): unknown;
}

/** Whether `host` is an allowed host or a subdomain of one. */
export function isAllowedHost(host: string, allowHosts: readonly string[]): boolean {
  const name = host.toLowerCase();
  return allowHosts.some((allowed) => name === allowed || name.endsWith(`.${allowed}`));
}

/** Whether the guard cancels a request to `url`. */
export function isBlockedRequest(url: string, allowHosts: readonly string[]): boolean {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  return NETWORK_PROTOCOLS.has(target.protocol) && !isAllowedHost(target.hostname, allowHosts);
}

export interface NetworkGuardOptions {
  /** Sessions that already exist (`session.defaultSession`). */
  sessions: readonly GuardableSession[];
  /** Guards every session created from now on. */
  app: SessionSource;
  allowHosts: readonly string[];
  /** The unexpected-requests log. */
  logFile: string;
}

export function installNetworkGuard({
  sessions,
  app,
  allowHosts,
  logFile,
}: NetworkGuardOptions): void {
  const guarded = new WeakSet<GuardableSession>();

  const guard = (session: GuardableSession): void => {
    if (guarded.has(session)) return;
    guarded.add(session);
    session.webRequest.onBeforeRequest((details, callback) => {
      if (!isBlockedRequest(details.url, allowHosts)) {
        callback({});
        return;
      }
      appendUnexpectedRequest(logFile, {
        source: 'network-guard',
        method: details.method,
        url: details.url,
        resourceType: details.resourceType,
      });
      callback({ cancel: true });
    });
  };

  sessions.forEach(guard);
  app.on('session-created', guard);
}
