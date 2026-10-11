/**
 * The website screenshots' fixtures (`tests/site/support/site-fixtures.ts`, used by
 * `npm run site:screenshots`): the campground map they serve is ParkStay's real catalogue,
 * read back by the provider's own mapping, and their bulk availability is the believable,
 * deterministic mix the screenshots promise.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { toLocationSummary } from '../../../src/main/providers/parkstay/catalog';
import type { RawBulkAvailability } from '../../../src/main/providers/parkstay/types';
import {
  BUNGARRA_ID,
  bulkAvailability,
  campgroundMap,
  readCatalogue,
  writeSiteFixtures,
} from '../../site/support/site-fixtures';

const catalogue = readCatalogue();

describe('website screenshot fixtures', () => {
  it('rebuild a campground map that maps back to all 169 campgrounds unchanged, photos included', () => {
    const map = campgroundMap(catalogue);
    const summaries = map.features.map((feature) => toLocationSummary(feature));
    expect(summaries).toHaveLength(169);
    expect(summaries).toEqual(catalogue);
    // Photos are ParkStay's own site paths, which the app resolves against its site.
    const paths = map.features.flatMap((feature) => feature.properties.images.map((i) => i.image));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.startsWith('/media/parkstay/campground_images/'))).toBe(true);
  });

  it('give Bungarra the free sites its recorded campsite view has, and a few free elsewhere', () => {
    const bulk = bulkAvailability(catalogue);
    expect(bulk.campground_available[BUNGARRA_ID]).toEqual({
      sites: [3, 4, 5],
      total_available: 5,
      total_bookable: 3,
    });
    const online = catalogue.filter((l) => l.bookingMode === 'online');
    const entries = online.map((l) => bulk.campground_available[l.externalId]);
    const free = entries.filter((e) => (e.total_bookable ?? 0) > 0);
    // Most places are full or not bookable online; some have a few sites free.
    expect(free.length).toBeGreaterThan(20);
    expect(free.length).toBeLessThan(online.length / 2);
    for (const entry of entries) {
      expect(entry.total_bookable).toBe(entry.sites.length);
      expect(entry.total_bookable!).toBeLessThan(entry.total_available!);
    }
    // Every region with places bookable online has some free.
    const regions = new Set(online.map((l) => l.area?.region));
    for (const region of regions) {
      const inRegion = online.filter((l) => l.area?.region === region);
      if (inRegion.length < 2) continue;
      expect(
        inRegion.some((l) => (bulk.campground_available[l.externalId].total_bookable ?? 0) > 0)
      ).toBe(true);
    }
    // Places not bookable online have no totals, as ParkStay answers.
    for (const location of catalogue.filter((l) => l.bookingMode !== 'online')) {
      expect(bulk.campground_available[location.externalId]).toEqual({ sites: [] });
    }
    expect(bulkAvailability(catalogue)).toEqual(bulk);
  });

  it('write the e2e folder with the map and availability replaced', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-site-fixtures-test-'));
    try {
      writeSiteFixtures(dir);
      const read = (file: string) =>
        JSON.parse(fs.readFileSync(path.join(dir, 'parkstay', file), 'utf8')) as unknown;
      const manifest = read('manifest.json') as { routes: Array<{ file: string }> };
      for (const route of manifest.routes) {
        expect(fs.existsSync(path.join(dir, 'parkstay', route.file))).toBe(true);
      }
      expect((read('campground_map.json') as { features: unknown[] }).features).toHaveLength(169);
      const bulk = read('campground_availabilty_view.json') as RawBulkAvailability;
      expect(Object.keys(bulk.campground_available)).toHaveLength(169);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
