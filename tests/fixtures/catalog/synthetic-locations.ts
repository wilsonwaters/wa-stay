/**
 * 5,000 seeded synthetic places across WA, for checking Explore at scale (the DEV-only
 * `?devFixture=5000` switch uses the same generator). Repeatable: the same seed, the same places.
 */

import { syntheticLocations } from '../../../src/renderer/features/explore/dev/syntheticLocations';

export { syntheticLocations };

export const SYNTHETIC_LOCATIONS_5K = syntheticLocations(5000);
