import { useId, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  Clock,
  Info,
  Map as MapIcon,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type {
  LocationDetail,
  LocationDocument,
  LocationNotice,
  LocationNoticeLevel,
  LocationSection,
  UnitSummary,
} from '../../../shared/types/catalog.types';
import { amenityIcon } from '../../components/amenityIcons';
import { ExternalLink } from '../../components/ExternalLink';
import { unitCountLabel, unitNoun } from '../../components/locationFormat';
import { RichText } from '../../components/RichText';
import { ApiError, useOpenLocationDocument } from '../../api';
import { Button, Disclosure, Notice, useToast, VisuallyHidden } from '../../components/ui';
import { BADGE_TONE_CLASS } from '../../components/ui/Badge';
import { cx } from '../../components/ui/cx';
import { guestRangeLabel, unitTypeBreakdown, type PlaceLinks } from './placeModel';

/** A titled part of the place page's main column. */
export function PlaceSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-xl font-semibold text-fg">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** "More information", with the host it goes to under it. */
export function MoreInformationLink({ info }: { info: { url: string; host: string } }) {
  return (
    <ExternalLink href={info.url} detail={info.host}>
      More information
    </ExternalLink>
  );
}

/** The link to read more on the provider's side: the info page, else its page, else its site. */
export function InfoLink({ links, shortName }: { links: PlaceLinks; shortName: string }) {
  if (links.info) return <MoreInformationLink info={links.info} />;
  if (links.view) return <ExternalLink href={links.view}>View on {shortName}</ExternalLink>;
  if (links.visit) return <ExternalLink href={links.visit}>Visit {shortName}</ExternalLink>;
  return null;
}

/** Each notice level's icon, its word for screen readers, and its colours. */
const NOTICE_LEVELS: Record<
  LocationNoticeLevel,
  { icon: LucideIcon; label: string; className: string }
> = {
  warning: { icon: OctagonAlert, label: 'Warning', className: BADGE_TONE_CLASS.danger },
  caution: { icon: TriangleAlert, label: 'Caution', className: BADGE_TONE_CLASS.warning },
  info: { icon: Info, label: 'Information', className: BADGE_TONE_CLASS.brand },
};

/** The order notices are shown in: warnings, then cautions, then information. */
const NOTICE_RANK: Record<LocationNoticeLevel, number> = { warning: 0, caution: 1, info: 2 };

/**
 * How many notices show before "Show all {n} notices": about two lines of the row at 1440 × 900
 * and at 960 × 640 with ParkStay's longer notices (Bungarra's).
 */
export const NOTICES_SHOWN = 3;

/** The notices by level, warnings first, keeping the provider's order within each level. */
function orderNotices(notices: readonly LocationNotice[]): LocationNotice[] {
  // An unknown level shows as information, so it sorts with it. The sort is stable.
  const rank = (notice: LocationNotice) => NOTICE_RANK[notice.level] ?? NOTICE_RANK.info;
  return [...notices].sort((a, b) => rank(a) - rank(b));
}

/**
 * The provider's notices as a compact row, warnings first: each with its level's icon (a
 * different shape for each level) and its level in words for screen readers, so colour is
 * never the only signal. Past {@link NOTICES_SHOWN}, the rest are behind "Show all {n} notices".
 */
export function PlaceNotices({
  notices,
  shortName,
}: {
  notices: readonly LocationNotice[];
  shortName: string;
}) {
  const listId = useId();
  const [showAll, setShowAll] = useState(false);
  if (notices.length === 0) return null;
  const ordered = orderNotices(notices);
  const collapsible = ordered.length > NOTICES_SHOWN;
  const shown = collapsible && !showAll ? ordered.slice(0, NOTICES_SHOWN) : ordered;
  return (
    <div className="flex flex-col items-start gap-2">
      <ul
        id={listId}
        role="list"
        aria-label={`Notices from ${shortName}`}
        className="flex max-w-2xl flex-wrap gap-2"
      >
        {shown.map((notice, index) => {
          const level = NOTICE_LEVELS[notice.level] ?? NOTICE_LEVELS.info;
          const Icon = level.icon;
          return (
            <li
              key={`${index}:${notice.text}`}
              className={cx(
                'inline-flex max-w-full items-start gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium',
                level.className
              )}
            >
              <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>
                <VisuallyHidden>{level.label}: </VisuallyHidden>
                {notice.text}
              </span>
            </li>
          );
        })}
      </ul>
      {collapsible && (
        <Button
          variant="ghost"
          size="sm"
          // Its text lines up with the notices' edge.
          className="-ml-3"
          aria-expanded={showAll}
          aria-controls={listId}
          trailingIcon={
            <ChevronDown
              size={16}
              aria-hidden="true"
              className={cx(
                'shrink-0 transition-transform duration-base ease-standard',
                showAll && 'rotate-180'
              )}
            />
          }
          onClick={() => setShowAll((all) => !all)}
        >
          {showAll ? 'Show fewer notices' : `Show all ${ordered.length} notices`}
        </Button>
      )}
    </div>
  );
}

/**
 * The description's sections as an accordion of disclosures, each titled by a heading button:
 * the first (the intro) open, the rest closed.
 */
export function DescriptionSections({ sections }: { sections: readonly LocationSection[] }) {
  return (
    <div className="max-w-2xl divide-y divide-border border-y border-border">
      {sections.map((section, index) => (
        <Disclosure
          key={`${index}:${section.title}`}
          summary={section.title}
          headingLevel={3}
          size="md"
          defaultOpen={index === 0}
        >
          <RichText html={section.html} />
        </Disclosure>
      ))}
    </div>
  );
}

/**
 * A button that opens the place's map document (its campground map) in a window of its own:
 * "Opening…" until it has arrived, and a toast when it could not be opened.
 */
export function MapDocumentButton({
  locationKey,
  document,
}: {
  locationKey: string;
  document: LocationDocument;
}) {
  const open = useOpenLocationDocument();
  const toast = useToast();
  return (
    <Button
      variant="secondary"
      size="sm"
      leadingIcon={<MapIcon size={16} aria-hidden="true" />}
      loading={open.isPending}
      onClick={() =>
        open.mutate(
          { locationKey, documentId: document.id },
          {
            onError: (error) =>
              toast.error(
                error instanceof ApiError && error.code === 'PROVIDER_ERROR'
                  ? error.message
                  : `Couldn't open the ${document.title.toLowerCase()}. Try again.`
              ),
          }
        )
      }
    >
      {open.isPending ? 'Opening…' : document.title}
    </Button>
  );
}

/**
 * About: the provider's notices, its map documents (the campground map), then its description in
 * sections (an accordion), or as one text (sanitised by main), or its summary, or a plain
 * sentence that it has none, with the link to read more.
 */
export function AboutSection({
  detail,
  shortName,
  links,
}: {
  detail: Pick<
    LocationDetail,
    'key' | 'descriptionHtml' | 'summary' | 'sections' | 'notices' | 'documents'
  >;
  shortName: string;
  links: PlaceLinks;
}) {
  const sections = Array.isArray(detail.sections) ? detail.sections : [];
  const notices = Array.isArray(detail.notices) ? detail.notices : [];
  const maps = Array.isArray(detail.documents)
    ? detail.documents.filter((document) => document.kind === 'map')
    : [];
  return (
    <PlaceSection title="About">
      {notices.length > 0 && (
        <div className="mb-6">
          <PlaceNotices notices={notices} shortName={shortName} />
        </div>
      )}
      {maps.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {maps.map((document) => (
            <MapDocumentButton key={document.id} locationKey={detail.key} document={document} />
          ))}
        </div>
      )}
      {sections.length > 0 ? (
        <DescriptionSections sections={sections} />
      ) : detail.descriptionHtml ? (
        <RichText html={detail.descriptionHtml} />
      ) : detail.summary ? (
        <p className="max-w-2xl text-base text-fg-secondary">{detail.summary}</p>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="text-base text-fg-secondary">
            {shortName} hasn&apos;t published a description.
          </p>
          <InfoLink links={links} shortName={shortName} />
        </div>
      )}
    </PlaceSection>
  );
}

/** Facilities: each with its icon and its name. */
export function FacilitiesSection({ amenities }: { amenities: readonly string[] }) {
  if (amenities.length === 0) return null;
  return (
    <PlaceSection title="Facilities">
      <ul role="list" className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {amenities.map((amenity) => {
          const Icon = amenityIcon(amenity);
          return (
            <li key={amenity} className="flex items-center gap-3 text-base text-fg">
              <Icon aria-hidden="true" className="shrink-0 text-fg-secondary" />
              {amenity}
            </li>
          );
        })}
      </ul>
    </PlaceSection>
  );
}

/**
 * Sites: how many, by type ("Tent site × 12"), how many guests they take, and every unit's
 * name behind "Show all {n} sites". Hidden when the provider lists no units.
 */
export function SitesSection({
  units,
  unitCount,
  kind,
}: {
  units: readonly UnitSummary[];
  /** The place's own count (the catalogue's), which can differ from the units listed. */
  unitCount?: number;
  kind: string;
}) {
  if (units.length === 0) return null;
  const noun = unitNoun(kind);
  const breakdown = unitTypeBreakdown(units);
  const guests = guestRangeLabel(units, noun);
  const title = noun.many.charAt(0).toUpperCase() + noun.many.slice(1);
  const count = unitCount && unitCount > 0 ? unitCount : units.length;
  // A provider can list kinds of unit rather than each one (ParkStay's "One site - select on
  // arrival" for 56 sites): then the list is of unit types, and says so.
  const byType = count !== units.length;
  const listed = byType
    ? units.length === 1
      ? `Show the ${noun.one} type`
      : `Show all ${units.length} ${noun.one} types`
    : units.length === 1
      ? `Show the ${noun.one}`
      : `Show all ${units.length} ${noun.many}`;
  return (
    <PlaceSection title={title}>
      <p className="text-base font-semibold text-fg">{unitCountLabel(kind, count)}</p>
      {byType && (
        <p className="mt-1 text-base text-fg-secondary">
          Bookable as {units.length} {noun.one} {units.length === 1 ? 'type' : 'types'}
        </p>
      )}
      {breakdown.some((group) => group.type !== null) && (
        <ul role="list" className="mt-2 flex flex-col gap-1 text-base text-fg-secondary">
          {breakdown.map((group) => (
            <li key={group.type ?? ''} className="tabular-nums">
              {group.type ?? 'Other'} × {group.count}
            </li>
          ))}
        </ul>
      )}
      {guests && <p className="mt-2 text-base text-fg-secondary">{guests}</p>}
      <Disclosure summary={listed} className="mt-4 max-w-2xl">
        <ul role="list" className="columns-2 gap-x-8 sm:columns-3">
          {units.map((unit) => (
            <li key={unit.unitId} className="break-inside-avoid py-0.5 text-fg">
              {unit.unitName}
            </li>
          ))}
        </ul>
      </Disclosure>
    </PlaceSection>
  );
}

/** Booking rules: the provider's release sentence, as calm information with a time cue. */
export function BookingRulesSection({ releaseInfo }: { releaseInfo?: string }) {
  if (!releaseInfo) return null;
  return (
    <PlaceSection title="Booking rules">
      <Notice tone="info" icon={Clock} className="max-w-2xl">
        {releaseInfo}
      </Notice>
    </PlaceSection>
  );
}
