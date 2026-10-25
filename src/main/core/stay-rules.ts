/**
 * A provider's published booking rules for a stay (`stayRules.check`), as the core uses them:
 * the catalogue's `stayRules` (the place page explains a stay before anything is checked), and
 * the watch and snipe services, which refuse a stay the provider would refuse.
 *
 * The provider's answer is checked before anyone sees it: plain text, each at most
 * `STAY_RULES_TEXT_MAX` characters (longer is cut, with an ellipsis), at most
 * `STAY_RULES_NOTES_MAX` notes and `STAY_RULES_SUGGESTIONS_MAX` suggestions, a refusal's field
 * one of `StayRuleField`, a release's `opensAt` an instant, and a suggestion's dates calendar
 * dates in order. A module that throws, or answers something else, gives no verdict (logged),
 * so a provider's rules never stop a watch it cannot judge.
 */

import type {
  StayRelease,
  StayRuleField,
  StayRulesVerdict,
  StaySuggestion,
} from '@shared/types/provider.types';
import { compareDates, isCalendarDate } from '@shared/utils/calendar-date';
import type { AccommodationProvider, StayRulesInput } from '../providers/sdk/provider';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'stay-rules' });

/** The most characters of any text in a verdict. */
export const STAY_RULES_TEXT_MAX = 200;
/** The most notes a verdict keeps. */
export const STAY_RULES_NOTES_MAX = 6;
/** The most suggestions a refusal keeps. */
export const STAY_RULES_SUGGESTIONS_MAX = 6;

const FIELDS: readonly StayRuleField[] = ['arrival', 'departure', 'guests', 'units'];

/** Where a refusal's field is in a watch or snipe input (`VALIDATION`'s `issues`). */
export const STAY_RULE_ISSUES: Readonly<Record<StayRuleField, string>> = {
  arrival: 'stay.arrival',
  departure: 'stay.departure',
  guests: 'stay.adults',
  units: 'unitIds',
};

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return undefined;
  return trimmed.length > STAY_RULES_TEXT_MAX
    ? `${trimmed.slice(0, STAY_RULES_TEXT_MAX - 1).trimEnd()}…`
    : trimmed;
}

function notesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(text)
    .filter((note): note is string => note !== undefined)
    .slice(0, STAY_RULES_NOTES_MAX);
}

function releaseOf(value: unknown): StayRelease | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { open, opensAt, expected, text: said } = value as Record<string, unknown>;
  const words = text(said);
  if (typeof open !== 'boolean' || !words) return undefined;
  const release: StayRelease = { open, text: words };
  if (typeof opensAt === 'string' && !Number.isNaN(Date.parse(opensAt))) {
    release.opensAt = new Date(opensAt).toISOString();
  }
  if (expected === true) release.expected = true;
  return release;
}

function suggestionsOf(value: unknown): StaySuggestion[] {
  if (!Array.isArray(value)) return [];
  const out: StaySuggestion[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const { arrival, departure } = item as Record<string, unknown>;
    if (typeof arrival !== 'string' || typeof departure !== 'string') continue;
    if (!isCalendarDate(arrival) || !isCalendarDate(departure)) continue;
    if (compareDates(arrival, departure) >= 0) continue;
    if (out.some((s) => s.arrival === arrival && s.departure === departure)) continue;
    out.push({ arrival, departure });
    if (out.length === STAY_RULES_SUGGESTIONS_MAX) break;
  }
  return out;
}

/** A verdict as the provider gave it, checked; undefined when it is not one. */
export function cleanVerdict(value: unknown): StayRulesVerdict | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const notes = notesOf(raw.notes);
  const release = releaseOf(raw.release);
  const withRelease = release ? { release } : {};
  if (raw.ok === true) return { ok: true, notes, ...withRelease };
  if (raw.ok !== false) return undefined;
  const reason = text(raw.reason);
  const field = FIELDS.find((f) => f === raw.field);
  if (!reason || !field) return undefined;
  const suggestions = suggestionsOf(raw.suggestions);
  return {
    ok: false,
    reason,
    field,
    notes,
    ...withRelease,
    ...(suggestions.length ? { suggestions } : {}),
  };
}

/**
 * What the provider's rules say about the stay; undefined when it has none, or its answer
 * could not be used (logged by the provider's id and the error's name only).
 */
export function checkStayRules(
  provider: Pick<AccommodationProvider, 'manifest' | 'stayRules'>,
  input: StayRulesInput
): StayRulesVerdict | undefined {
  const rules = provider.stayRules;
  if (!rules) return undefined;
  let answer: unknown;
  try {
    answer = rules.check(input);
  } catch (error) {
    log.warn(
      `${provider.manifest.id}: stayRules.check threw (${error instanceof Error ? error.name : 'error'}); no verdict`
    );
    return undefined;
  }
  const verdict = cleanVerdict(answer);
  if (!verdict) log.warn(`${provider.manifest.id}: stayRules.check gave no verdict it could use`);
  return verdict;
}
