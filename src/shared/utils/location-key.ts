/**
 * Location keys: `${providerId}:${externalId}`, the globally unique id of a location
 * (architecture-notes §2). A provider id never contains `:`, so a key splits on its
 * **first** `:` and the external id may contain more of them (`parkstay:12:3`).
 */

import { z } from 'zod';
import { PROVIDER_ID_PATTERN, type ProviderId } from '../types/provider.types';

export const LOCATION_KEY_SEPARATOR = ':';

export interface LocationKeyParts {
  providerId: ProviderId;
  externalId: string;
}

function invalid(reason: string): Error {
  return new Error(`Invalid location key: ${reason}`);
}

export function makeLocationKey(providerId: ProviderId, externalId: string): string {
  if (!PROVIDER_ID_PATTERN.test(providerId)) throw invalid(`bad provider id "${providerId}"`);
  if (!externalId) throw invalid('empty external id');
  return `${providerId}${LOCATION_KEY_SEPARATOR}${externalId}`;
}

/** Splits a key on its first `:`. Throws on a key without one, or with an empty or bad part. */
export function parseLocationKey(key: string): LocationKeyParts {
  const at = key.indexOf(LOCATION_KEY_SEPARATOR);
  if (at < 0) throw invalid(`"${key}" has no "${LOCATION_KEY_SEPARATOR}"`);
  const providerId = key.slice(0, at);
  const externalId = key.slice(at + 1);
  if (!PROVIDER_ID_PATTERN.test(providerId)) throw invalid(`bad provider id "${providerId}"`);
  if (!externalId) throw invalid('empty external id');
  return { providerId, externalId };
}

export function isLocationKey(value: string): boolean {
  try {
    parseLocationKey(value);
    return true;
  } catch {
    return false;
  }
}

export const LocationKeySchema = z
  .string()
  .refine(isLocationKey, 'Expected a location key "<providerId>:<externalId>"');
