/**
 * RAC's availability answer (`availability-ajax.php`, `ai-state/research/rac-booking-flow.md`
 * §3): its raw shape, and how a category's answer becomes a unit with its nights.
 *
 * **The raw shape.** A zod shape with only the fields WA Stay reads. Unknown keys are stripped,
 * so a tariff's cart address is never read, and nor is the NewBook key RAC echoes. PHP writes an
 * empty map as `[]`, which reads as an empty map. Counts, codes and amounts may come as numbers
 * or as numeric text; one that is neither reads as missing. An answer that is not JSON, has
 * another shape, says `success` other than `"true"`, or is RAC's guard text (`No direct file
 * access`, sent without `X-Requested-With`) is no answer (`readAvailability`), never an empty
 * one.
 *
 * **Tariffs.** A tariff counts when RAC says `tariff_success: "true"` and it is public: its label
 * does not say "RAC Member" (members' rates come with the member number, later). Prices come
 * from the cheapest tariff that counts: each night's `tariffs_quoted[date].amount`, and the
 * stay's `tariff_total`. A refused tariff never gives a price (its total can be a placeholder,
 * `999`). Nor does NewBook's placeholder amount, `999`, which a tariff that counts quotes for a
 * night just inside the 364-day window (the night has no price, and the stay no total).
 * `priceNote` is the tariff's label when it is not "Standard Rate".
 *
 * **Nights**, from `sites_code[date]` and `sites_available[date]`:
 *
 * | RAC | `NightStatus` |
 * | --- | --- |
 * | 0, with free sites | `available`, with its price |
 * | 3 or 5, or 0 with no free sites | `booked` |
 * | 2, 4, 6, 7 or 8 | `closed`, labelled with RAC's message |
 * | 9 | `not-released` |
 * | 1, any other, or no entry | `unknown` |
 *
 * A category RAC says is closed for the stay (stay-through code 2: "This Site is closed as
 * of …") with no night closed of its own is closed every night it has no free site, labelled
 * with that message.
 *
 * **Stay rules.** Each free night carries the rules of the tariff the prices come from (else of
 * the deciding tariff, below): `minNights` from `minimum_periods`, `noArrival` and
 * `noDeparture` from `close_arrival` and `close_departure` being 1. The unit's `minNights` is the
 * arrival night's, from 2 up. When that minimum is above the stay's nights, no free night is
 * `available`: each is `unknown` with `min-stay`.
 *
 * **The stay.** `fullyAvailable` only when every night is available, the whole stay has a site
 * (`stay_through_sites_available` above 0, with code 0), a tariff counts, and the arrival night
 * takes arrivals and this many nights. When some nights are booked, closed or not released, the
 * free nights stay `available`, so partial matches still work. Otherwise the free nights become,
 * in this order:
 * 1. `unknown` with `split`: every night has free sites, but no site is free for the whole stay
 *    (stay-through code 3 or 5, or 0 with no site);
 * 2. `unknown` with `min-stay`: the stay rules above refuse it, or no tariff counts and the
 *    deciding tariff (the public "Standard Rate", else the first public tariff) has code 6, 7,
 *    9 or 10;
 * 3. `closed`, labelled with RAC's message: the deciding tariff's code 2, 3, 4, 8 or 11, or the
 *    stay-through code 2, 4, 6, 7 or 8;
 * 4. `not-released`: the deciding tariff's code 5, or the stay-through code 9;
 * 5. `unknown` otherwise.
 *
 * Messages are plain text: tags stripped, entities decoded, every part RAC joined with `; `
 * kept. Dates are calendar strings throughout, never `Date` objects.
 */

import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import type { NightStatus, StayQuery, UnitAvailability } from '@shared/types/provider.types';

/** What RAC answers a request without `X-Requested-With`. */
export const RAC_GUARD_TEXT = 'No direct file access';

// ---------------------------------------------------------------------------------------
// The raw shape
// ---------------------------------------------------------------------------------------

const NUMERIC = /^\s*-?\d+(?:\.\d+)?\s*$/;

/** A number, or numeric text, as a number; anything else as undefined. */
function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && NUMERIC.test(value)) return Number(value);
  return undefined;
}

const looseNumber = z.unknown().transform(toNumber);

/** A JSON object keyed by date or id. PHP writes an empty one as `[]`. */
function keyed<T extends z.ZodType>(value: T) {
  return z.union([
    z.record(z.string(), value),
    z
      .array(z.unknown())
      .length(0)
      .transform((): Record<string, z.output<T>> => ({})),
  ]);
}

const text = z
  .unknown()
  .transform((value) => (typeof value === 'string' ? value : undefined))
  .optional();

const RawQuoteSchema = z.object({
  amount: looseNumber,
  minimum_periods: looseNumber,
  close_arrival: looseNumber,
  close_departure: looseNumber,
});

const RawTariffSchema = z.object({
  tariff_label: z.string(),
  tariff_success: z.union([z.string(), z.boolean()]),
  tariff_code: looseNumber,
  tariff_message: text,
  tariff_total: looseNumber,
  tariffs_quoted: keyed(RawQuoteSchema).nullish(),
});

const RawCategorySchema = z.object({
  category_id: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),
  category_type_id: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((value) => (value === null || value === undefined ? undefined : String(value))),
  category_name: z.string().min(1),
  sites_available: keyed(looseNumber),
  sites_code: keyed(looseNumber),
  sites_message: keyed(text).nullish(),
  stay_through_sites_available: looseNumber,
  stay_through_sites_code: looseNumber,
  stay_through_sites_message: text,
  online_booking_url: text,
  sort: looseNumber,
  tariffs_available: z.array(RawTariffSchema).nullish(),
});

const RawAnswerSchema = z.object({
  success: z.union([z.string(), z.boolean()]),
  message: text,
  data: z.union([keyed(RawCategorySchema), z.array(RawCategorySchema)]).nullish(),
});

export type RawQuote = z.output<typeof RawQuoteSchema>;
export type RawTariff = z.output<typeof RawTariffSchema>;
export type RawCategory = z.output<typeof RawCategorySchema>;

/** An availability answer read, or why it is none. */
export type AvailabilityReading =
  { ok: true; categories: RawCategory[] } | { ok: false; why: string };

/** RAC's `sort`, then the name: the order RAC's own page lists the categories in. */
function byRacOrder(a: RawCategory, b: RawCategory): number {
  const sa = a.sort ?? Number.MAX_SAFE_INTEGER;
  const sb = b.sort ?? Number.MAX_SAFE_INTEGER;
  return sa - sb || a.category_name.localeCompare(b.category_name);
}

/** The categories of an availability answer, in RAC's order, or why it is no answer. */
export function readAvailability(body: string): AvailabilityReading {
  if (body.trim().startsWith(RAC_GUARD_TEXT)) {
    return { ok: false, why: `it answered "${RAC_GUARD_TEXT}"` };
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, why: 'its answer is not JSON' };
  }
  const parsed = RawAnswerSchema.safeParse(json);
  if (!parsed.success) return { ok: false, why: 'its answer has an unexpected shape' };
  const { success, message, data } = parsed.data;
  if (success !== 'true' && success !== true) {
    const said = plainText(message ?? '');
    return { ok: false, why: said ? `it said "${said}"` : 'it did not say the search succeeded' };
  }
  const categories = Array.isArray(data) ? data : Object.values(data ?? {});
  return { ok: true, categories: [...categories].sort(byRacOrder) };
}

// ---------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-11-06` → `6 Nov 2026`, the form RAC's page sends, from the calendar string alone. */
export function toRacDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month || Number(match[3]) < 1 || Number(match[3]) > 31) {
    throw new RangeError(`Not a calendar date: ${date}`);
  }
  return `${Number(match[3])} ${month} ${match[1]}`;
}

/** The most pets RAC takes in one booking (terms rule 16). */
export const RAC_MAX_PETS = 2;

/**
 * The stay's pets (`params.pets`): 0 when it has none, undefined when the value is not a whole
 * number from 0 to 2.
 */
export function petsOf(stay: Pick<StayQuery, 'params'>): number | undefined {
  const pets = stay.params?.pets;
  if (pets === undefined) return 0;
  return typeof pets === 'number' && Number.isInteger(pets) && pets >= 0 && pets <= RAC_MAX_PETS
    ? pets
    : undefined;
}

// ---------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------

/** RAC's message as plain text: tags stripped, entities decoded, white space collapsed. */
export function plainText(html: string): string {
  const escaped = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
  return escaped
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------------------
// Tariffs
// ---------------------------------------------------------------------------------------

const STANDARD_RATE = 'standard rate';

/** NewBook's amount for a night it has no rate for yet. */
export const RAC_PLACEHOLDER_AMOUNT = 999;

/** The tariff's price for the night, unless it has none (or only the placeholder). */
export function nightPriceOf(tariff: RawTariff | undefined, date: string): number | undefined {
  const amount = tariff?.tariffs_quoted?.[date]?.amount;
  return amount !== undefined && amount >= 0 && amount !== RAC_PLACEHOLDER_AMOUNT
    ? amount
    : undefined;
}

/** A members' tariff ("RAC Member Rate", "Stay & Save This Spring - RAC Member"). */
export function isMemberTariff(tariff: Pick<RawTariff, 'tariff_label'>): boolean {
  return /\bRAC Member\b/i.test(tariff.tariff_label);
}

/** RAC took the tariff for this stay. */
function succeeded(tariff: RawTariff): boolean {
  return tariff.tariff_success === 'true' || tariff.tariff_success === true;
}

/** A tariff that counts: public, and RAC took it for the stay. */
export function countsTariff(tariff: RawTariff): boolean {
  return succeeded(tariff) && !isMemberTariff(tariff);
}

/**
 * The cheapest tariff that counts, by its total (one without a total last), the first on a
 * tie; undefined when none counts.
 */
export function priceTariffOf(tariffs: readonly RawTariff[]): RawTariff | undefined {
  let cheapest: RawTariff | undefined;
  for (const tariff of tariffs.filter(countsTariff)) {
    const total = tariff.tariff_total ?? Number.POSITIVE_INFINITY;
    if (!cheapest || total < (cheapest.tariff_total ?? Number.POSITIVE_INFINITY)) {
      cheapest = tariff;
    }
  }
  return cheapest;
}

/** When no tariff counts: the public "Standard Rate", else the first public tariff. */
export function decidingTariffOf(tariffs: readonly RawTariff[]): RawTariff | undefined {
  const publicTariffs = tariffs.filter((tariff) => !isMemberTariff(tariff));
  return (
    publicTariffs.find((tariff) => tariff.tariff_label.trim().toLowerCase() === STANDARD_RATE) ??
    publicTariffs[0]
  );
}

/** The price note for prices from `tariff`: its label, unless it is the Standard Rate. */
export function priceNoteOf(tariff: RawTariff): string | undefined {
  const label = plainText(tariff.tariff_label);
  return label && label.toLowerCase() !== STANDARD_RATE ? label : undefined;
}

type StayRules = Pick<NightStatus, 'minNights' | 'noArrival' | 'noDeparture'>;

/** The tariff's rules for a stay arriving on `date`: its minimum and its closed days. */
export function rulesOf(tariff: RawTariff | undefined, date: string): StayRules {
  const quote = tariff?.tariffs_quoted?.[date];
  if (!quote) return {};
  const rules: StayRules = {};
  const minimum = quote.minimum_periods;
  if (minimum !== undefined && Number.isInteger(minimum) && minimum >= 1) {
    rules.minNights = minimum;
  }
  if (quote.close_arrival === 1) rules.noArrival = true;
  if (quote.close_departure === 1) rules.noDeparture = true;
  return rules;
}

// ---------------------------------------------------------------------------------------
// Nights and the stay
// ---------------------------------------------------------------------------------------

const BOOKED_SITE_CODES = new Set([3, 5]);
const CLOSED_SITE_CODES = new Set([2, 4, 6, 7, 8]);
const NOT_RELEASED_SITE_CODE = 9;
const CLOSED_CATEGORY_CODE = 2;
const MIN_STAY_TARIFF_CODES = new Set([6, 7, 9, 10]);
const CLOSED_TARIFF_CODES = new Set([2, 3, 4, 8, 11]);
const NOT_RELEASED_TARIFF_CODE = 5;

function closedNight(date: string, message: string | undefined): NightStatus {
  const label = plainText(message ?? '');
  return { date, state: 'closed', ...(label ? { label } : {}) };
}

/** A night from its site code and free sites (the table above). */
export function siteNight(category: RawCategory, date: string): NightStatus {
  const code = category.sites_code[date];
  const free = category.sites_available[date];
  if (code === 0) {
    if (free === undefined) return { date, state: 'unknown' };
    return { date, state: free > 0 ? 'available' : 'booked' };
  }
  if (code !== undefined && BOOKED_SITE_CODES.has(code)) return { date, state: 'booked' };
  if (code !== undefined && CLOSED_SITE_CODES.has(code)) {
    return closedNight(date, category.sites_message?.[date]);
  }
  if (code === NOT_RELEASED_SITE_CODE) return { date, state: 'not-released' };
  return { date, state: 'unknown' };
}

/** What the free nights of a stay that is not free become. */
type Verdict =
  | { state: 'unknown'; reason?: 'split' | 'min-stay' }
  | { state: 'closed'; message?: string }
  | { state: 'not-released' };

/** No site is free for the whole stay, though RAC said nothing else is wrong with it. */
function noSiteForStay(category: RawCategory): boolean {
  const code = category.stay_through_sites_code;
  const free = category.stay_through_sites_available ?? 0;
  return (code === 0 && free <= 0) || (code !== undefined && BOOKED_SITE_CODES.has(code));
}

function verdictOf(category: RawCategory, deciding: RawTariff | undefined, rulesRefuse: boolean) {
  const stayCode = category.stay_through_sites_code;
  const tariffCode = deciding?.tariff_code;
  let verdict: Verdict = { state: 'unknown' };
  if (noSiteForStay(category)) verdict = { state: 'unknown', reason: 'split' };
  else if (rulesRefuse || (tariffCode !== undefined && MIN_STAY_TARIFF_CODES.has(tariffCode))) {
    verdict = { state: 'unknown', reason: 'min-stay' };
  } else if (tariffCode !== undefined && CLOSED_TARIFF_CODES.has(tariffCode)) {
    verdict = { state: 'closed', message: deciding?.tariff_message };
  } else if (stayCode !== undefined && CLOSED_SITE_CODES.has(stayCode)) {
    verdict = { state: 'closed', message: category.stay_through_sites_message };
  } else if (tariffCode === NOT_RELEASED_TARIFF_CODE || stayCode === NOT_RELEASED_SITE_CODE) {
    verdict = { state: 'not-released' };
  }
  return verdict;
}

/** A free night the provider refuses under its stay rules, with the rules it has. */
function minStayNight(date: string, rules: StayRules): NightStatus {
  return { date, state: 'unknown', reason: 'min-stay', ...rules };
}

/** What a category's answer says about a unit, before its id, name, kind and link. */
export type CategoryAvailability = Pick<
  UnitAvailability,
  'nights' | 'fullyAvailable' | 'total' | 'minNights' | 'priceNote'
>;

/** A category's nights for the stay's `nights` (its dates, in order), and the stay's verdict. */
export function categoryAvailability(
  category: RawCategory,
  nights: readonly string[]
): CategoryAvailability {
  const tariffs = category.tariffs_available ?? [];
  const priceTariff = priceTariffOf(tariffs);
  const deciding = priceTariff ? undefined : decidingTariffOf(tariffs);
  const rulesTariff = priceTariff ?? deciding;

  let unitNights = nights.map((date) => siteNight(category, date));

  // A category closed for the stay, with no night of its own closed: closed whenever not free
  const closedForStay =
    category.stay_through_sites_code === CLOSED_CATEGORY_CODE &&
    !nights.some((date) => category.sites_code[date] === CLOSED_CATEGORY_CODE);
  if (closedForStay) {
    unitNights = unitNights.map((night) =>
      night.state === 'available'
        ? night
        : closedNight(night.date, category.stay_through_sites_message)
    );
  }

  // The free nights' prices (only from a tariff that counts) and stay rules
  unitNights = unitNights.map((night) => {
    if (night.state !== 'available') return night;
    const price = nightPriceOf(priceTariff, night.date);
    return {
      ...night,
      ...(price !== undefined ? { price } : {}),
      ...rulesOf(rulesTariff, night.date),
    };
  });

  const arrivalRules = nights.length > 0 ? rulesOf(rulesTariff, nights[0]) : {};
  const minimum = arrivalRules.minNights ?? 1;
  const tooShort = minimum > nights.length;
  const allFree = nights.length > 0 && unitNights.every((night) => night.state === 'available');
  const stayHasSite =
    category.stay_through_sites_code === 0 && (category.stay_through_sites_available ?? 0) > 0;
  const fullyAvailable =
    allFree &&
    stayHasSite &&
    priceTariff !== undefined &&
    !tooShort &&
    arrivalRules.noArrival !== true;

  if (allFree && !fullyAvailable) {
    const verdict = verdictOf(category, deciding, tooShort || arrivalRules.noArrival === true);
    unitNights = unitNights.map((night): NightStatus => {
      if (verdict.state === 'closed') return closedNight(night.date, verdict.message);
      if (verdict.state === 'not-released') return { date: night.date, state: 'not-released' };
      if (verdict.reason === 'min-stay') {
        return minStayNight(night.date, rulesOf(rulesTariff, night.date));
      }
      return {
        date: night.date,
        state: 'unknown',
        ...(verdict.reason ? { reason: verdict.reason } : {}),
      };
    });
  } else if (tooShort) {
    // Some nights are taken, and the stay is shorter than RAC's minimum: no free night counts
    unitNights = unitNights.map((night) =>
      night.state === 'available'
        ? minStayNight(night.date, rulesOf(rulesTariff, night.date))
        : night
    );
  }

  const result: CategoryAvailability = { nights: unitNights, fullyAvailable };
  const total = priceTariff?.tariff_total;
  if (fullyAvailable && total !== undefined && unitNights.every((n) => n.price !== undefined)) {
    result.total = total;
  }
  if (minimum >= 2) result.minNights = minimum;
  const note = priceTariff ? priceNoteOf(priceTariff) : undefined;
  if (note) result.priceNote = note;
  return result;
}
