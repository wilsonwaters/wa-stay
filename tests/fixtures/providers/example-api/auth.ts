/**
 * Example Parks' sign-in: the worked example of a `browser-session` sign-in in
 * docs/providers/adding-a-provider.md.
 *
 * The person signs in on Example Parks' own pages (and its identity provider's) in the app's
 * sign-in window. `GET /api/me` answers 200 with the account for a signed-in session, and 401
 * without one. Tests run it against a loopback server
 * (`tests/unit/docs/example-providers.test.ts`).
 *
 * Each region between `// #region docs:<name>` and `// #endregion` is a code block of the
 * guide, word for word; `tests/unit/docs/docs-sync.test.ts` keeps the two in step.
 */

// #region docs:auth
import { z } from 'zod';
import {
  isAbortError,
  ProviderHttpError,
  ProviderParseError,
  ProviderTimeoutError,
  type BrowserSessionAuth,
  type HttpClient,
  type Limiter,
} from '@main/providers/sdk';
import type { AccountStatus } from '@shared/types/provider.types';

/** What `GET /api/me` answers for a signed-in session. Only the email and name are read. */
const RawMe = z.object({ email: z.string().min(1), name: z.string().optional() });

const unknown = (reason: string): AccountStatus => ({ state: 'unknown', reason });

export function createExampleAuth(options: {
  apiUrl: string;
  siteUrl: string;
  /** The provider's limiter: the check waits its turn with every other request. */
  limit: Limiter;
}): BrowserSessionAuth {
  const { apiUrl, siteUrl, limit } = options;
  return {
    kind: 'browser-session',
    // Where the sign-in window opens. It runs on the provider's session partition, so the
    // cookies the person gets there are the ones ctx.http sends.
    signInUrl: `${siteUrl}/account/sign-in`,
    // Every top-level https origin the sign-in flow visits, the identity provider included.
    allowedOrigins: [siteUrl, 'https://login.example-parks.test'],
    // Pages that mean "probably signed in": the app then asks isSignedIn to be sure.
    completionUrlPatterns: [`${siteUrl}/account/welcome*`],

    // Asks the provider with the partition's cookies (`http`). Only a definite answer is
    // signed in or signed out; anything else is `unknown` with a reason, and the app keeps the
    // last definite answer.
    async isSignedIn(http: HttpClient, signal?: AbortSignal): Promise<AccountStatus> {
      try {
        // Through the limiter, like every request, with the answer read inside it.
        const answer = await limit(async () => {
          const response = await http.request('GET', `${apiUrl}/api/me`, {
            headers: { Accept: 'application/json' },
            timeoutMs: 15_000,
            signal,
          });
          const found = response.status === 200;
          return { status: response.status, body: found ? await response.json() : undefined };
        });
        if (answer.status === 401 || answer.status === 403) return { state: 'signed-out' };
        if (answer.status !== 200) return unknown(`http ${answer.status}`);
        const me = RawMe.safeParse(answer.body);
        if (!me.success) return unknown('parse');
        const { email, name } = me.data;
        return { state: 'signed-in', email, ...(name ? { displayName: name } : {}) };
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (error instanceof ProviderTimeoutError) return unknown('timeout');
        if (error instanceof ProviderParseError) return unknown('parse');
        if (error instanceof ProviderHttpError) {
          return unknown(error.status === 0 ? 'network' : `http ${error.status}`);
        }
        throw error;
      }
    },
  };
}
// #endregion
