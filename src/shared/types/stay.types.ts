/**
 * The provider-aware parts every watch, snipe and booking share (architecture-notes §2, §5):
 * which provider and location it is for, the stay (calendar dates and party), the units it
 * wants and the provider's own stay fields.
 *
 * No node or electron imports: the renderer compiles this file too.
 */

import { z } from 'zod';
import { assertTypeEquals } from '../utils/type-equality';
import {
  CalendarDateSchema,
  type ProviderId,
  type StayParams,
  type StayQuery,
} from './provider.types';

/** A provider's location, by the provider's own id for it. */
export interface LocationRef {
  /** The provider's id for the location (ParkStay: the campground id). */
  externalId: string;
  name: string;
  /** The area the location is in: park, town or region (ParkStay: the park). */
  areaName?: string;
}

/** A booking's location. Bookings entered by hand may not know the provider's id for it. */
export interface BookingLocationRef {
  externalId?: string;
  name: string;
  areaName?: string;
}

/** The dates and party of a watch, snipe or booking. */
export interface Stay {
  /** Calendar date `YYYY-MM-DD`. */
  arrival: string;
  /** Calendar date `YYYY-MM-DD`, after `arrival`. */
  departure: string;
  adults: number;
  children: number;
  infants: number;
  concessions: number;
}

/** A `Stay` as create and update requests send it. Missing party counts are 0. */
export interface StayInput {
  /** Calendar date `YYYY-MM-DD`. */
  arrival: string;
  /** Calendar date `YYYY-MM-DD`, after `arrival`. */
  departure: string;
  adults: number;
  children?: number;
  infants?: number;
  concessions?: number;
}

/** A stored stay and its provider stay fields as the `StayQuery` a provider module takes. */
export function toStayQuery(stay: Stay, params: StayParams = {}): StayQuery {
  return {
    arrival: stay.arrival,
    departure: stay.departure,
    adults: stay.adults,
    children: stay.children,
    infants: stay.infants,
    concessions: stay.concessions,
    params,
  };
}

/** `${providerId}:${externalId}`, the location key (§2). Never throws, unlike `makeLocationKey`. */
export function locationKeyOf(providerId: ProviderId, externalId: string): string {
  return `${providerId}:${externalId}`;
}

// ---------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------

export const LocationRefSchema = z.object({
  externalId: z.string().min(1),
  name: z.string(),
  areaName: z.string().optional(),
});
assertTypeEquals<z.input<typeof LocationRefSchema>, LocationRef>(true);
assertTypeEquals<z.output<typeof LocationRefSchema>, LocationRef>(true);

export const BookingLocationRefSchema = z.object({
  externalId: z.string().min(1).optional(),
  name: z.string(),
  areaName: z.string().optional(),
});
assertTypeEquals<z.input<typeof BookingLocationRefSchema>, BookingLocationRef>(true);
assertTypeEquals<z.output<typeof BookingLocationRefSchema>, BookingLocationRef>(true);

const partyCount = z.number().int().nonnegative();

export const StayInputSchema = z
  .object({
    arrival: CalendarDateSchema,
    departure: CalendarDateSchema,
    adults: partyCount,
    children: partyCount.optional(),
    infants: partyCount.optional(),
    concessions: partyCount.optional(),
  })
  // Same-format calendar dates compare correctly as strings.
  .refine((stay) => stay.departure > stay.arrival, {
    error: 'Departure must be after arrival',
    path: ['departure'],
  });
assertTypeEquals<z.input<typeof StayInputSchema>, StayInput>(true);
assertTypeEquals<z.output<typeof StayInputSchema>, StayInput>(true);
