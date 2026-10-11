/**
 * Example Parks' holds: the worked example of a holds module in
 * docs/providers/adding-a-provider.md.
 *
 * Example Parks' API places a hold with `POST /api/holds` and answers 201 with its reference
 * and expiry. The person pays on Example Parks' own checkout page, in the app's payment window;
 * once paid, it shows "Booking <reference> confirmed" at `/checkout/<reference>/confirmed`.
 * Tests run it on recorded responses and a loopback server
 * (`tests/unit/docs/example-providers.test.ts`); nothing ever places a real hold.
 *
 * Each region between `// #region docs:<name>` and `// #endregion` is a code block of the
 * guide, word for word; `tests/unit/docs/docs-sync.test.ts` keeps the two in step.
 */

// #region docs:holds
import { z } from 'zod';
import {
  ProviderParseError,
  type HoldFailureReason,
  type HoldResult,
  type HoldsModule,
  type HttpClient,
  type Limiter,
} from '@main/providers/sdk';
import type { ProviderId } from '@shared/types/provider.types';

/** What `POST /api/holds` answers with a 201. */
const RawHold = z.object({
  hold: z.object({ reference: z.string().min(1), expiresAt: z.iso.datetime(), siteId: z.string() }),
});

/** The statuses Example Parks refuses a hold with, and what each means. */
const REFUSALS: Record<number, HoldFailureReason> = {
  401: 'auth-required',
  403: 'auth-required',
  409: 'taken',
  422: 'invalid',
  423: 'in-progress',
};

export interface ExampleHoldsOptions {
  providerId: ProviderId;
  http: HttpClient;
  /** The provider's limiter: a hold waits its turn with every other request. */
  limit: Limiter;
  /** The API, for `POST /api/holds`. */
  apiUrl: string;
  /** The website, whose checkout the payment window opens. */
  siteUrl: string;
}

export function createExampleHolds(options: ExampleHoldsOptions): HoldsModule {
  const { providerId, http, limit, apiUrl, siteUrl } = options;
  const checkout = (reference: string): string =>
    `${siteUrl}/checkout/${encodeURIComponent(reference)}`;

  return {
    async create({ externalId, unitId, stay }, signal): Promise<HoldResult> {
      const url = `${apiUrl}/api/holds`;
      // Through the limiter, like every request, with the answer read inside it. An abort or
      // a failed request rejects (the core logs it); a refusal is a result.
      const answer = await limit(async () => {
        const response = await http.request('POST', url, {
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            parkId: externalId,
            // No unit: Example Parks picks a free site for the stay.
            siteId: unitId ?? null,
            arrival: stay.arrival,
            departure: stay.departure,
            guests: stay.adults + (stay.children ?? 0),
          }),
          signal,
        });
        const created = response.status === 201;
        return { status: response.status, body: created ? await response.json() : undefined };
      });
      if (answer.status !== 201) {
        return {
          ok: false,
          reason: REFUSALS[answer.status] ?? 'error',
          message: `Example Parks did not hold the site (HTTP ${answer.status})`,
        };
      }
      const parsed = RawHold.safeParse(answer.body);
      if (!parsed.success) {
        throw new ProviderParseError({ providerId, url, message: 'Unexpected /api/holds answer' });
      }
      const { reference, expiresAt, siteId } = parsed.data.hold;
      return { ok: true, reference, expiresAt: new Date(expiresAt), unitId: siteId };
    },

    // The payment window opens here, on the provider's session partition.
    paymentUrl: (hold) => checkout(hold.reference),
    // The top-level origins it may visit: the checkout and the card payment page.
    paymentOrigins: [siteUrl, 'https://pay.example-parks.test'],

    // Strict: only this hold's own confirmation page, showing its reference, means it is paid.
    async bookedReference(hold, page) {
      if (page.url.split(/[?#]/)[0] !== `${checkout(hold.reference)}/confirmed`) return null;
      return (await page.hasText(`Booking ${hold.reference} confirmed`)) ? hold.reference : null;
    },
  };
}
// #endregion
