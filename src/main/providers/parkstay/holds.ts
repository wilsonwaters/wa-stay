/**
 * ParkStay temporary holds: `POST /api/create_booking` (CSRF-exempt, form-encoded) puts a
 * 30-minute booking for one site (or, at campgrounds listed by class, one site of a class)
 * in the session (`api.py:2938-3380`). The booking id goes into the session as `ps_booking`,
 * so the person pays on the same session at `/booking/` (`api.py:3373-3376`): the payment
 * window must use the provider's partition.
 *
 * A class unit (`class:<id>`, `site-classes.ts`) is held with `campsite_class`: ParkStay
 * refuses a site at such a campground, and itself picks the first site of the class that is
 * free for the whole stay (`utils.py:186-202`). A site id kept from before #21 is first
 * resolved to a class by a fresh check, unless this run's view says the campground lists
 * sites, so it is never posted as `campsite` where ParkStay books classes.
 *
 * Answers: `{status:'success', pk}`; 400 `{inprogress_booking:true}` when the session
 * already has a booking; 400 "The system is currently closed for bookings."; any other 400
 * when the site was taken or the request was refused.
 *
 * Payment: `create_booking` also sets `session['checkouthash'] = sha256(str(pk))`
 * (`api.py:3375`), and the payment ledger returns to `/success/?checkouthash=<that hash>`
 * (`utils.py:1766`). The URL alone does not indicate payment (`views.py:880-912`): when the
 * session's hash differs, `/success/` answers 200 with `success-error.html` ("Your booking
 * session has expired."); when the basket was not paid it falls back to the session's
 * previous booking (`ps_last_booking`). Both templates extend `ps/base.html` without a title
 * of their own, so the page title cannot tell them apart. The success page says
 * "Your booking PB<pk> is completed" (`success.html`), so a booking is recorded only for
 * `/success/` on ParkStay with the hold's own hash that shows the hold's own booking number
 * (`PB` + pk, `BOOKING_PREFIX`), found with the browser's find-in-page.
 */

import { createHash } from 'crypto';
import type { ProviderContext } from '../sdk/context';
import { throwIfAborted } from '../sdk/errors';
import type {
  HoldRequest,
  HoldResult,
  HoldsModule,
  HoldSuccess,
  PaymentPage,
} from '../sdk/provider';
import type { CampgroundFacts } from './catalog';
import { toParkStayDate, type ParkStayClient } from './client';
import { BOOKING_PREFIX, HOLD_MINUTES, PARKSTAY_BASE_URL, PAYMENT_ORIGINS } from './constants';
import { classIdOfUnit } from './site-classes';
import type { RawCreateBookingResponse } from './types';

/** `msg` as text: a string, `{ error }`, or anything else serialised. */
function messageOf(body: RawCreateBookingResponse | undefined, fallback: string): string {
  const msg = body?.msg;
  if (typeof msg === 'string' && msg.trim()) return msg.trim();
  if (msg && typeof msg === 'object') {
    const error = (msg as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) {
      // Some refusals are HTML fragments meant for the ParkStay page.
      return error
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    return JSON.stringify(msg);
  }
  return fallback;
}

function numberParam(request: HoldRequest, key: string): number | undefined {
  const value = request.stay.params?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringParam(request: HoldRequest, key: string): string | undefined {
  const value = request.stay.params?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export interface HoldsDeps {
  ctx: Pick<ProviderContext, 'id' | 'clock' | 'logger'>;
  client: ParkStayClient;
  facts: CampgroundFacts;
  /**
   * A fully available unit for the stay, from a fresh availability check, if there is one:
   * any unit, or one of those `unitIds` name.
   */
  findFreeUnit(
    externalId: string,
    stay: HoldRequest['stay'],
    signal?: AbortSignal,
    unitIds?: string[]
  ): Promise<string | undefined>;
}

/** The form fields `create_booking` reads (`api.py:2986-3003`). */
export function createBookingForm(
  request: HoldRequest,
  facts?: CampgroundFacts
): Record<string, string> {
  const { stay, externalId, unitId } = request;
  const form: Record<string, string> = {
    arrival: toParkStayDate(stay.arrival),
    departure: toParkStayDate(stay.departure),
    num_adult: String(stay.adults),
    num_concession: String(stay.concessions ?? 0),
    num_child: String(stay.children ?? 0),
    num_infant: String(stay.infants ?? 0),
    num_vehicle: String(numberParam(request, 'numVehicles') ?? 1),
    num_campervan: '0',
    num_caravan: '0',
    num_motorcycle: '0',
    num_trailer: '0',
    campground: externalId,
    // ParkStay's page sends it empty; `create_booking` fails on a missing one (`int(None)`).
    change_booking_id: '',
  };
  const postcode = stringParam(request, 'postcode');
  if (postcode) form.postcode = postcode;

  // A campground listed by class is booked by class: a class unit names its class; a site id
  // the view gave names its class, and any site id the class when there is only one.
  const view = facts?.view(externalId);
  const byClass = !!unitId && !!view && view.siteType !== 0;
  const unitClass =
    classIdOfUnit(unitId) ??
    (byClass
      ? (view.classOfUnit.get(unitId) ??
        (view.classIds.length === 1 ? view.classIds[0] : undefined))
      : undefined);
  const campsiteClass = request.unitGroupId ?? unitClass;
  if (unitId && !unitClass) form.campsite = unitId;
  else if (campsiteClass) form.campsite_class = campsiteClass;
  return form;
}

export function createHolds({ ctx, client, facts, findFreeUnit }: HoldsDeps): HoldsModule {
  async function create(request: HoldRequest, signal?: AbortSignal): Promise<HoldResult> {
    throwIfAborted(signal);
    // Any unit will do: take the first one that is free for the whole stay (at a campground
    // listed by class, a class; ParkStay then picks the site).
    if (!request.unitId && !request.unitGroupId) {
      const unitId = await findFreeUnit(request.externalId, request.stay, signal);
      if (!unitId) return { ok: false, reason: 'taken', message: 'No site is free for the stay' };
      request = { ...request, unitId };
    } else if (request.unitId && !request.unitGroupId && !classIdOfUnit(request.unitId)) {
      // A site id: unless this run's view says the campground lists sites, a fresh check says
      // which unit it is now (a class, where ParkStay books classes) and whether it is free.
      if (facts.view(request.externalId)?.siteType !== 0) {
        const unitId = await findFreeUnit(request.externalId, request.stay, signal, [
          request.unitId,
        ]);
        if (!unitId)
          return { ok: false, reason: 'taken', message: 'The site is not free for the stay' };
        request = { ...request, unitId };
      }
    }
    const form = createBookingForm(request, facts);
    const { status, body } = await client.postApiForm('/create_booking', form, { signal });
    const answer = (
      typeof body === 'object' && body !== null ? body : {}
    ) as RawCreateBookingResponse;

    if (status < 300 && answer.status === 'success' && answer.pk !== undefined) {
      const hold: HoldSuccess = {
        ok: true,
        reference: String(answer.pk),
        expiresAt: new Date(ctx.clock().getTime() + HOLD_MINUTES * 60_000),
      };
      if (form.campsite) hold.unitId = form.campsite;
      else if (request.unitId) hold.unitId = request.unitId;
      return hold;
    }
    if (answer.inprogress_booking) {
      return {
        ok: false,
        reason: 'in-progress',
        message: messageOf(answer, 'A booking is already in progress in this session'),
      };
    }
    const message = messageOf(answer, 'ParkStay did not place the hold');
    if (/closed for bookings/i.test(message)) return { ok: false, reason: 'closed', message };
    // A refusal at this point is almost always the site going between the check and the hold.
    return { ok: false, reason: status >= 400 ? 'taken' : 'error', message };
  }

  return {
    create,
    paymentUrl: () => `${PARKSTAY_BASE_URL}/booking/`,
    paymentOrigins: PAYMENT_ORIGINS,
    async bookedReference(hold: { reference: string }, page: PaymentPage) {
      const success = successPage(page.url);
      if (!success) return null;
      if (success.checkouthash !== checkoutHash(hold.reference)) {
        // Another booking's confirmation: not this hold's payment
        ctx.logger.warn('Payment window: a /success/ page for another booking; ignored');
        return null;
      }
      const reference = `${BOOKING_PREFIX}${hold.reference}`;
      if (!(await page.hasText(reference))) {
        // `success-error.html`, or the previous booking's page: no payment for this hold
        ctx.logger.warn('Payment window: /success/ does not show this booking; not recorded');
        return null;
      }
      return reference;
    },
  };
}

/** `sha256(str(pk))` as hex, as `create_booking` stores it (`api.py:3375`). */
export function checkoutHash(reference: string): string {
  return createHash('sha256').update(reference, 'utf8').digest('hex');
}

/** ParkStay's `/success/` page and its `checkouthash`, or null for any other URL. */
function successPage(url: string): { checkouthash: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== PARKSTAY_BASE_URL) return null;
  if (parsed.pathname !== '/success' && !parsed.pathname.startsWith('/success/')) return null;
  return { checkouthash: (parsed.searchParams.get('checkouthash') ?? '').toLowerCase() };
}
