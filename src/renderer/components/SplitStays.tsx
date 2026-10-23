/**
 * Split stays (§12.36): a stay free every night, but only by moving between units, shown for
 * what it is and never as "available". The block under a place's night grid and on a watch
 * that found one: how many units it moves across (when known), the parts, the price ("about",
 * always), and how to book it: contact the place (`contact`), or book each part on the
 * provider's site (`separate`). Main works the split stays and their links out
 * (`LocationCheck.splitStays`, `Watch.splitStays`); this only shows them.
 */
import { useId } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import type { ProviderId, SplitStay, SplitStayPart } from '../../shared/types/provider.types';
import { nightsBetween } from '../../shared/utils/calendar-date';
import { nounForKinds, unitCountLabel, type UnitNoun } from '../../shared/utils/unit-noun';
import { CopyCredentialButton } from './accounts/CopyCredentialButton';
import { ExternalLink } from './ExternalLink';
import { formatPrice, stayRangeLabel } from './nightGridModel';
import { stayNightsLabel } from './stay/stayFormat';
import { Card, VisuallyHidden } from './ui';

/**
 * What the split stays' units are called: by the kinds they use (each stays within one), else
 * `fallback`, the page's noun (the place's or the watch's).
 */
export function splitStaysNoun(splitStays: readonly SplitStay[], fallback: UnitNoun): UnitNoun {
  const kinds = splitStays.map((split) => split.unitKind).filter((kind) => kind !== undefined);
  return kinds.length > 0 ? nounForKinds(kinds) : fallback;
}

/** "Free if you move sites": the block's heading, and what an announcement adds. */
export function splitStaysTitle(splitStays: readonly SplitStay[], fallback: UnitNoun): string {
  return `Free if you move ${splitStaysNoun(splitStays, fallback).many}`;
}

/**
 * What a watch found, in a line (its card, and Check now's toast before " at {place}"): the
 * best split stay's count, "Free across 2 sites", else "Free if you move sites".
 */
export function splitStayResultLine(
  splitStays: readonly SplitStay[] | undefined,
  fallback: UnitNoun
): string {
  const best = splitStays?.[0];
  if (!best) return `Free if you move ${fallback.many}`;
  const noun = best.unitKind ? nounForKinds([best.unitKind]) : fallback;
  return wholeCount(best.units) !== undefined
    ? `Free across ${unitCountLabel(best.units as number, noun)}`
    : `Free if you move ${noun.many}`;
}

/** A count of units to show: a whole number of at least 2, else none. */
function wholeCount(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 2 ? value : undefined;
}

/** A price to show: a finite amount, else none. */
function priceOf(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** One split stay's heading: the unit the provider reported it on, else "Across 2 sites". */
function itemHeading(split: SplitStay, noun: UnitNoun): string {
  if (split.unitName) return split.unitName;
  const units = wholeCount(split.units);
  return units !== undefined
    ? `Across ${unitCountLabel(units, noun)}`
    : `Across more than one ${noun.one}`;
}

/** "CAMPSITE 03 · 6–7 Nov · 1 night · $25". */
function partLine(part: SplitStayPart, currency: string | undefined): string {
  const total = priceOf(part.total);
  return [
    part.unitName,
    stayRangeLabel(part.arrival, part.departure),
    stayNightsLabel(part.arrival, part.departure),
    ...(total !== undefined ? [formatPrice(total, currency)] : []),
  ].join(' · ');
}

/**
 * Words added, for screen readers only, to the links that would otherwise share a name
 * ("Book 6–7 Nov on ParkStay" at two units): the part's unit ("for Campsite"), then its split
 * stay's heading, then its place in the list. Each starts with a space and a word, so the name
 * reads the same however the hidden text is spaced. Keyed `${split}:${part}`; most links need
 * none.
 */
function linkQualifiers(
  splitStays: readonly SplitStay[],
  shortName: string,
  headingOf: (split: SplitStay) => string
): Map<string, string> {
  const links = splitStays.flatMap((split, i) =>
    (split.booking === 'separate' ? (split.parts ?? []) : [])
      .map((part, j) => ({ part, key: `${i}:${j}` }))
      .filter(({ part }) => Boolean(part.bookingUrl))
      .map(({ part, key }) => ({
        key,
        name: `Book ${stayRangeLabel(part.arrival, part.departure)} on ${shortName}`,
        extras: [` for ${part.unitName}`, ` under ${headingOf(split)}`, ` in choice ${i + 1}`],
        added: '',
      }))
  );
  for (let level = 0; level < 3; level += 1) {
    const seen = new Map<string, number>();
    for (const link of links) {
      const name = link.name + link.added;
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    for (const link of links) {
      if ((seen.get(link.name + link.added) ?? 0) > 1) link.added += link.extras[level];
    }
  }
  return new Map(links.filter((link) => link.added).map((link) => [link.key, link.added]));
}

export interface SplitStaysProps {
  /** Best first, as main gives them; nothing shows without any. */
  splitStays: readonly SplitStay[];
  /** The place's name: who books a split stay through the place. */
  place: string;
  /** For "Copy {label}" beside "Contact {place}" while a copyable detail is saved. */
  providerId: ProviderId | undefined;
  /** The provider's short name: "Book 6–7 Nov on ParkStay". */
  shortName: string;
  /** The stay the split stays are for. */
  arrival: string;
  departure: string;
  /** What units are called when the split stays give no kind: the page's noun. */
  noun: UnitNoun;
  /** The manifest's currency, for prices. */
  currency?: string;
  /** "Contact {place}" is the view's one call to action (a watch's page): coral. */
  primary?: boolean;
}

/**
 * The split stays of one stay: a `section` named by its `h3` ("Free if you move sites"), what
 * it means, then each split stay under an `h4` (the unit the provider reported it on, or
 * "Across 2 sites"): how many units it moves across when known, "About $450 for the 5 nights"
 * when every night has a price, and for a `separate` one its parts as an ordered list, each
 * with "Book 6–7 Nov on ParkStay". Split stays booked through the place share one "{place} can
 * book this for you as separate stays." and one "Contact {place}" (or the words alone, without
 * a link), with "Copy {label}" beside it. Every link opens in the browser, and no two share a
 * name.
 */
export function SplitStays({
  splitStays,
  place,
  providerId,
  shortName,
  arrival,
  departure,
  noun,
  currency,
  primary = false,
}: SplitStaysProps) {
  const headingId = useId();
  if (splitStays.length === 0) return null;
  const blockNoun = splitStaysNoun(splitStays, noun);
  const nights = nightsBetween(arrival, departure);
  const nounOf = (split: SplitStay) =>
    split.unitKind ? nounForKinds([split.unitKind]) : blockNoun;
  const qualifiers = linkQualifiers(splitStays, shortName, (split) =>
    itemHeading(split, nounOf(split))
  );
  const contacts = splitStays.filter((split) => split.booking === 'contact');
  const contactUrl = contacts.find((split) => split.contactUrl)?.contactUrl;

  return (
    <Card as="section" aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="flex items-center gap-2 text-lg font-semibold text-fg">
          <ArrowLeftRight size={20} aria-hidden="true" className="shrink-0 text-warning-fg" />
          {`Free if you move ${blockNoun.many}`}
        </h3>
        <p className="max-w-2xl text-sm text-fg-secondary">
          {`No ${blockNoun.one} is free for all ${nights} nights, but every night is free if you move between ${blockNoun.many}. It takes more than one booking.`}
        </p>
      </div>

      {splitStays.map((split, i) => {
        const own = nounOf(split);
        const units = wholeCount(split.units);
        const total = priceOf(split.total);
        const parts = split.booking === 'separate' ? (split.parts ?? []) : [];
        return (
          <div key={`${split.unitId ?? 'across'}:${i}`} className="flex flex-col gap-2">
            <h4 className="text-base font-semibold text-fg">{itemHeading(split, own)}</h4>
            {split.unitName && units !== undefined && (
              <p className="text-sm text-fg-secondary">Across {unitCountLabel(units, own)}</p>
            )}
            {total !== undefined && (
              <p className="text-sm text-fg-secondary tabular-nums">
                About {formatPrice(total, currency)} for the {nights} nights
              </p>
            )}
            {parts.length > 0 && (
              <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-fg">
                {parts.map((part, j) => {
                  const range = stayRangeLabel(part.arrival, part.departure);
                  const added = qualifiers.get(`${i}:${j}`);
                  return (
                    <li key={`${part.arrival}:${part.unitId}`} className="tabular-nums">
                      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span>{partLine(part, currency)}</span>
                        {part.bookingUrl && (
                          <ExternalLink href={part.bookingUrl}>
                            Book {range} on {shortName}
                            {added && <VisuallyHidden>{added}</VisuallyHidden>}
                          </ExternalLink>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            {split.booking === 'separate' && (
              <p className="text-sm text-fg-secondary">
                {parts.length > 0
                  ? `Book each part on ${shortName}: ${parts.length} bookings in all.`
                  : `Book each part on ${shortName}.`}
              </p>
            )}
          </div>
        );
      })}

      {contacts.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="max-w-2xl text-sm text-fg">
            {place} can book {contacts.length === 1 ? 'this' : 'any of these'} for you as separate
            stays.{!contactUrl && ` Contact ${place} to book it.`}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {contactUrl && (
              <ExternalLink href={contactUrl} variant={primary ? 'primary' : 'secondary'}>
                Contact {place}
              </ExternalLink>
            )}
            <CopyCredentialButton providerId={providerId} />
          </div>
        </div>
      )}
    </Card>
  );
}

export default SplitStays;
