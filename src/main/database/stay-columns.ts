/**
 * Column mapping shared by the provider-aware tables (watches, site_snipes, bookings, v8):
 * the stay columns and the `unit_ids` / `stay_params` JSON columns.
 *
 * Reads are defensive. A legacy row whose JSON is malformed reads as an empty value with a
 * warning instead of failing the whole list, and stay dates are passed through as stored,
 * so a row the v8 migration could not normalise reaches the services, which mark it in
 * error.
 */

import type { Stay, StayInput, StayParams } from '@shared/types';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'repositories' });

export interface StayRow {
  arrival_date: string;
  departure_date: string;
  num_adults: number | null;
  num_children: number | null;
  num_infants: number | null;
  num_concessions: number | null;
}

export function readStay(row: StayRow): Stay {
  return {
    arrival: String(row.arrival_date ?? ''),
    departure: String(row.departure_date ?? ''),
    adults: row.num_adults ?? 0,
    children: row.num_children ?? 0,
    infants: row.num_infants ?? 0,
    concessions: row.num_concessions ?? 0,
  };
}

/** `arrival_date, departure_date, num_adults, num_children, num_infants, num_concessions` values. */
export function stayValues(stay: StayInput): [string, string, number, number, number, number] {
  return [
    stay.arrival,
    stay.departure,
    stay.adults,
    stay.children ?? 0,
    stay.infants ?? 0,
    stay.concessions ?? 0,
  ];
}

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/** `unit_ids` as a string array. NULL or empty is `[]`; anything but a JSON array is `[]` with a warning. */
export function readUnitIds(json: string | null | undefined, where: string): string[] {
  if (json === null || json === undefined || json === '') return [];
  const value = parse(json);
  if (Array.isArray(value)) {
    return value
      .filter((id): id is string | number => typeof id === 'string' || typeof id === 'number')
      .map(String);
  }
  log.warn(`${where}: unit_ids is not a JSON array; read as []`);
  return [];
}

/**
 * `stay_params` as an object of string, number and boolean values. NULL or empty is `{}`;
 * anything but a JSON object is `{}` with a warning. Members of any other type are dropped.
 */
export function readStayParams(json: string | null | undefined, where: string): StayParams {
  if (json === null || json === undefined || json === '') return {};
  const value = parse(json);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    log.warn(`${where}: stay_params is not a JSON object; read as {}`);
    return {};
  }
  const params: StayParams = {};
  for (const [key, member] of Object.entries(value)) {
    if (typeof member === 'string' || typeof member === 'number' || typeof member === 'boolean') {
      params[key] = member;
    }
  }
  return params;
}
