import { getMapboxToken } from './mapboxToken';
import { supportsWebGL } from './webgl';

export type MapSupport =
  { available: true; token: string } | { available: false; reason: 'no-token' | 'no-webgl' };

/**
 * Whether Explore can show the map: it needs a public token in the build and WebGL. Without
 * either, Explore is a list, and nothing is requested from Mapbox.
 */
export function detectMapSupport(): MapSupport {
  const token = getMapboxToken();
  if (!token) return { available: false, reason: 'no-token' };
  if (!supportsWebGL()) return { available: false, reason: 'no-webgl' };
  return { available: true, token };
}
