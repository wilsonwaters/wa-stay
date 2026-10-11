/**
 * `locations`: the cached catalogue of every provider (migration v8), with the FTS5 index
 * `locations_fts` kept in sync by triggers. The catalogue service (`core/catalog`) syncs it
 * and searches it through `search`.
 *
 * Rows are written with `INSERT … ON CONFLICT DO UPDATE`, never `INSERT OR REPLACE`: a
 * REPLACE deletes the old row without firing the FTS delete trigger, which would leave a
 * stale entry in the index.
 *
 * Search SQL is built only from the code-literal fragments below; every value, list and
 * FTS expression is bound as a `?` parameter (lists as JSON, read with `json_each`).
 */

import type {
  BoundingBox,
  CatalogQuery,
  CatalogSearchResult,
  FacetCount,
  LocationSummary,
  ProviderId,
} from '@shared/types';
import { CATALOG_MAX_LIMIT, locationKeyOf } from '@shared/types';
import type { ProviderLocationDetail } from '../../providers/sdk/provider';
import { BaseRepository, readInstant } from './base.repository';

/**
 * The words of a search text, for FTS5. Anything that is not a letter, digit or combining
 * mark separates words, as the `unicode61` tokenizer does, so FTS syntax (`" * ^ ( ) : - +`)
 * never reaches the query; the operators `AND`, `OR`, `NOT` and `NEAR` are dropped too.
 */
export function searchWords(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((word) => word !== '' && !/^(?:AND|OR|NOT|NEAR)$/i.test(word));
}

/**
 * The FTS5 query for a search text: each word as a quoted prefix, `"word"*`, all required
 * (`AND`). `undefined` when the text has no words (empty, whitespace or punctuation only).
 */
export function toFtsQuery(text: string | undefined): string | undefined {
  const words = searchWords(text);
  return words.length ? words.map((word) => `"${word}"*`).join(' AND ') : undefined;
}

/** The facet a search counts with every filter but its own. */
type Facet = 'providers' | 'kinds' | 'regions' | 'amenities';

interface SqlPart {
  sql: string;
  params: unknown[];
}

/** FTS5 column weights for `bm25`: name, area, region, summary. A name match ranks first. */
const BM25 = 'bm25(locations_fts, 8.0, 4.0, 2.0, 1.0)';
const BY_NAME = 'l.name COLLATE NOCASE, l.provider_id, l.external_id';

interface LocationRow {
  id: number;
  provider_id: string;
  external_id: string;
  name: string;
  kind: string;
  booking_mode: string;
  lat: number;
  lng: number;
  area_name: string | null;
  region: string | null;
  summary: string | null;
  description_html: string | null;
  image_urls: string | null;
  amenities: string | null;
  unit_count: number | null;
  info_url: string | null;
  booking_url: string | null;
  raw: string | null;
  fetched_at: string;
  detail: string | null;
  detail_fetched_at: string | null;
}

export interface UpsertLocationsResult {
  /** Rows inserted or updated. */
  upserted: number;
  /** The provider's rows that were not in the set, now deleted. */
  deleted: number;
}

export interface MergeLocationsResult {
  /** Locations inserted or updated (each external id once). */
  stored: number;
  /** Of those, the ones that were not stored before. */
  added: number;
}

export interface CachedLocationDetail {
  /** As the provider gave it (cleaned): its documents carry their address, for main only. */
  detail: ProviderLocationDetail;
  fetchedAt: Date;
}

/** The column each single-valued facet counts. Code constants. */
const FACET_COLUMN: Record<Exclude<Facet, 'amenities'>, string> = {
  providers: 'l.provider_id',
  kinds: 'l.kind',
  regions: 'l.region',
};

export class LocationRepository extends BaseRepository<LocationSummary> {
  protected readonly tableName = 'locations';

  /**
   * Makes `summaries` the provider's whole catalogue, in one transaction: each one is
   * inserted or updated (a cached detail is kept, and so is a stored summary when the
   * provider sends none), and the provider's rows that are not in the set are deleted, with
   * their cached detail. Every summary must belong to `providerId`.
   */
  upsertMany(
    providerId: ProviderId,
    summaries: LocationSummary[],
    fetchedAt: Date
  ): UpsertLocationsResult {
    return this.transaction(() => {
      this.upsertRows(providerId, summaries, fetchedAt);
      const { changes: deleted } = this.db
        .prepare(
          `DELETE FROM locations
           WHERE provider_id = ? AND external_id NOT IN (SELECT value FROM json_each(?))`
        )
        .run(providerId, JSON.stringify(summaries.map((s) => s.externalId)));
      return { upserted: summaries.length, deleted };
    });
  }

  /**
   * Adds `summaries` to the provider's catalogue, in one transaction: each one is inserted or
   * updated as `upsertMany` does, and no other row is touched. For a catalogue that is
   * searched (`catalogMode: 'search'`), never listed whole. Every summary must belong to
   * `providerId`.
   */
  mergeMany(
    providerId: ProviderId,
    summaries: LocationSummary[],
    fetchedAt: Date
  ): MergeLocationsResult {
    return this.transaction(() => {
      const count = (): number =>
        (
          this.db
            .prepare('SELECT COUNT(*) AS n FROM locations WHERE provider_id = ?')
            .get(providerId) as { n: number }
        ).n;
      const before = count();
      this.upsertRows(providerId, summaries, fetchedAt);
      return {
        stored: new Set(summaries.map((s) => s.externalId)).size,
        added: count() - before,
      };
    });
  }

  /** Inserts or updates each summary; the caller holds the transaction. */
  private upsertRows(providerId: ProviderId, summaries: LocationSummary[], fetchedAt: Date): void {
    const foreign = summaries.find((s) => s.providerId !== providerId);
    if (foreign) {
      throw new Error(`Location ${foreign.key} does not belong to provider ${providerId}`);
    }

    const upsert = this.db.prepare(`
      INSERT INTO locations (
        provider_id, external_id, name, kind, booking_mode, lat, lng, area_name, region,
        summary, image_urls, amenities, unit_count, info_url, booking_url, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (provider_id, external_id) DO UPDATE SET
        name = excluded.name,
        kind = excluded.kind,
        booking_mode = excluded.booking_mode,
        lat = excluded.lat,
        lng = excluded.lng,
        area_name = excluded.area_name,
        region = excluded.region,
        -- A provider without summaries keeps the one derived from the cached detail (FTS)
        summary = COALESCE(NULLIF(excluded.summary, ''), locations.summary),
        image_urls = excluded.image_urls,
        amenities = excluded.amenities,
        unit_count = excluded.unit_count,
        info_url = excluded.info_url,
        booking_url = excluded.booking_url,
        fetched_at = excluded.fetched_at
    `);
    for (const s of summaries) {
      upsert.run(
        providerId,
        s.externalId,
        s.name,
        s.kind,
        s.bookingMode,
        s.lat,
        s.lng,
        s.area?.name ?? null,
        s.area?.region ?? null,
        s.summary ?? null,
        JSON.stringify(s.imageUrls),
        JSON.stringify(s.amenities),
        s.unitCount ?? null,
        s.infoUrl ?? null,
        s.bookingUrl ?? null,
        fetchedAt.toISOString()
      );
    }
  }

  /** The cached summary of one location, or null. */
  get(providerId: ProviderId, externalId: string): LocationSummary | null {
    const row = this.findRow(providerId, externalId);
    return row ? this.mapRow(row) : null;
  }

  /** Caches a location's detail. Returns false when the location is not in the catalogue. */
  setDetail(
    providerId: ProviderId,
    externalId: string,
    detail: ProviderLocationDetail,
    fetchedAt: Date
  ): boolean {
    const { changes } = this.db
      .prepare(
        `UPDATE locations SET detail = ?, description_html = ?, detail_fetched_at = ?
         WHERE provider_id = ? AND external_id = ?`
      )
      .run(
        JSON.stringify(detail),
        detail.descriptionHtml ?? null,
        fetchedAt.toISOString(),
        providerId,
        externalId
      );
    return changes > 0;
  }

  /** The cached detail and when it was fetched, or null when none is cached. */
  getDetail(providerId: ProviderId, externalId: string): CachedLocationDetail | null {
    const row = this.findRow(providerId, externalId);
    const detail = row ? this.parseJson<ProviderLocationDetail>(row.detail) : undefined;
    if (!row || !detail) return null;
    return { detail, fetchedAt: readInstant(row.detail_fetched_at) ?? new Date(0) };
  }

  /**
   * Stores `summary` for a location whose summary is empty (FTS indexes it). Returns false
   * when the location is missing or already has one.
   */
  setSummaryIfEmpty(providerId: ProviderId, externalId: string, summary: string): boolean {
    const { changes } = this.db
      .prepare(
        `UPDATE locations SET summary = ?
         WHERE provider_id = ? AND external_id = ? AND (summary IS NULL OR trim(summary) = '')`
      )
      .run(summary, providerId, externalId);
    return changes > 0;
  }

  /** The external ids of the provider's cached locations, inside `bbox` when given. */
  externalIds(providerId: ProviderId, bbox?: BoundingBox): Set<string> {
    const area = bbox ? this.bboxPart(bbox) : { sql: '1', params: [] };
    const rows = this.db
      .prepare(`SELECT l.external_id FROM locations l WHERE l.provider_id = ? AND ${area.sql}`)
      .all(providerId, ...area.params) as { external_id: string }[];
    return new Set(rows.map((r) => r.external_id));
  }

  /**
   * Searches the catalogue (`CatalogQuery`, architecture-notes §12.15) within `scope`, the
   * providers whose rows may be returned (the registered catalogue providers).
   *
   * - `text`: every word as an FTS5 prefix (`toFtsQuery`); ranked by `bm25` unless `sort` is
   *   `name`. Without words the text is ignored and results are sorted by name.
   * - `providerIds` (ids outside `scope` are ignored), `kinds`, `regions` and `bookingModes`
   *   match any value; `amenities` must all be present; `bbox` is `[west, south, east, north]`.
   *   An empty list is no filter.
   * - `limit` (default and maximum 5000) and `offset` page the items; `total` counts every
   *   match.
   * - `facets` count values over what every *other* filter matches, so a chip can show how
   *   many it would add.
   */
  search(query: CatalogQuery, scope: readonly ProviderId[]): CatalogSearchResult {
    const fts = toFtsQuery(query.text);
    const limit = Math.min(Math.max(query.limit ?? CATALOG_MAX_LIMIT, 1), CATALOG_MAX_LIMIT);
    const offset = Math.max(query.offset ?? 0, 0);
    const where = this.filters(query, scope, fts);

    const ranked = fts !== undefined && query.sort !== 'name';
    const rows = ranked
      ? this.db
          .prepare(
            `SELECT l.* FROM locations l JOIN locations_fts ON locations_fts.rowid = l.id
             WHERE locations_fts MATCH ? AND ${where.sql}
             ORDER BY ${BM25}, ${BY_NAME} LIMIT ? OFFSET ?`
          )
          .all(fts, ...where.params, limit, offset)
      : this.db
          .prepare(
            `SELECT l.* FROM locations l WHERE ${where.sql}
             ORDER BY ${BY_NAME} LIMIT ? OFFSET ?`
          )
          .all(...where.params, limit, offset);
    const { total } = this.db
      .prepare(`SELECT COUNT(*) AS total FROM locations l WHERE ${where.sql}`)
      .get(...where.params) as { total: number };

    return {
      items: (rows as LocationRow[]).map((row) => this.mapRow(row)),
      total,
      facets: {
        regions: this.facet('regions', query, scope, fts),
        amenities: this.facet('amenities', query, scope, fts),
        kinds: this.facet('kinds', query, scope, fts),
        providers: this.facet('providers', query, scope, fts),
      },
    };
  }

  /** Counts per value of `facet` over the rows every other filter matches. */
  private facet(
    facet: Facet,
    query: CatalogQuery,
    scope: readonly ProviderId[],
    fts: string | undefined
  ): FacetCount[] {
    const where = this.filters(query, scope, fts, facet);
    const sql =
      facet === 'amenities'
        ? `SELECT a.value AS value, COUNT(DISTINCT l.id) AS count
           FROM locations l, json_each(l.amenities) a
           WHERE ${where.sql} AND a.type = 'text'
           GROUP BY a.value`
        : `SELECT ${FACET_COLUMN[facet]} AS value, COUNT(*) AS count
           FROM locations l
           WHERE ${where.sql} AND ${FACET_COLUMN[facet]} IS NOT NULL
           GROUP BY ${FACET_COLUMN[facet]}`;
    return this.db
      .prepare(`${sql} ORDER BY count DESC, value COLLATE NOCASE`)
      .all(...where.params) as FacetCount[];
  }

  /** The WHERE clause for `query` (minus the filter of `except`), as code-literal SQL. */
  private filters(
    query: CatalogQuery,
    scope: readonly ProviderId[],
    fts: string | undefined,
    except?: Facet
  ): SqlPart {
    const parts: SqlPart[] = [];
    const inList = (column: string, values: readonly string[]): SqlPart => ({
      sql: `${column} IN (SELECT value FROM json_each(?))`,
      params: [JSON.stringify(values)],
    });

    const providers =
      except !== 'providers' && query.providerIds?.length
        ? query.providerIds.filter((id) => scope.includes(id))
        : scope;
    parts.push(inList('l.provider_id', providers));
    if (except !== 'kinds' && query.kinds?.length) parts.push(inList('l.kind', query.kinds));
    if (except !== 'regions' && query.regions?.length) {
      parts.push(inList('l.region', query.regions));
    }
    if (query.bookingModes?.length) parts.push(inList('l.booking_mode', query.bookingModes));
    if (except !== 'amenities' && query.amenities?.length) {
      // Every wanted amenity is one of the location's.
      parts.push({
        sql: `NOT EXISTS (
          SELECT 1 FROM json_each(?) want
          WHERE NOT EXISTS (SELECT 1 FROM json_each(l.amenities) have WHERE have.value = want.value)
        )`,
        params: [JSON.stringify(query.amenities)],
      });
    }
    if (query.bbox) parts.push(this.bboxPart(query.bbox));
    if (fts !== undefined) {
      parts.push({
        sql: 'l.id IN (SELECT rowid FROM locations_fts WHERE locations_fts MATCH ?)',
        params: [fts],
      });
    }
    return {
      sql: parts.map((p) => `(${p.sql})`).join(' AND '),
      params: parts.flatMap((p) => p.params),
    };
  }

  private bboxPart([west, south, east, north]: BoundingBox): SqlPart {
    return {
      sql: 'l.lng BETWEEN ? AND ? AND l.lat BETWEEN ? AND ?',
      params: [west, east, south, north],
    };
  }

  /** How many locations each provider has cached. Providers with none are absent. */
  countByProvider(): Record<ProviderId, number> {
    const rows = this.db
      .prepare('SELECT provider_id, COUNT(*) AS n FROM locations GROUP BY provider_id')
      .all() as { provider_id: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.provider_id, r.n]));
  }

  private findRow(providerId: ProviderId, externalId: string): LocationRow | undefined {
    return this.db
      .prepare('SELECT * FROM locations WHERE provider_id = ? AND external_id = ?')
      .get(providerId, externalId) as LocationRow | undefined;
  }

  protected mapRow(row: LocationRow): LocationSummary {
    const strings = (json: string | null): string[] => {
      const value = this.parseJson<unknown>(json);
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    };
    return {
      key: locationKeyOf(row.provider_id, row.external_id),
      providerId: row.provider_id,
      externalId: row.external_id,
      name: row.name,
      kind: row.kind as LocationSummary['kind'],
      bookingMode: row.booking_mode as LocationSummary['bookingMode'],
      lat: row.lat,
      lng: row.lng,
      ...(row.area_name !== null
        ? { area: { name: row.area_name, ...(row.region !== null ? { region: row.region } : {}) } }
        : {}),
      ...(row.summary !== null ? { summary: row.summary } : {}),
      imageUrls: strings(row.image_urls),
      amenities: strings(row.amenities),
      ...(row.unit_count !== null ? { unitCount: row.unit_count } : {}),
      ...(row.info_url !== null ? { infoUrl: row.info_url } : {}),
      ...(row.booking_url !== null ? { bookingUrl: row.booking_url } : {}),
    };
  }
}
