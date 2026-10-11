/**
 * Explore's stay for availability (E3): the dates and guests in its URL, when they make a
 * stay a provider can be asked about. Pure.
 */

import type { StayQuery } from '../../../../shared/types/provider.types';
import {
  compareDates,
  isCalendarDate,
  nightsBetween,
} from '../../../../shared/utils/calendar-date';
import { MAX_NIGHTS } from '../search/SearchPill';

export interface ExploreStayParams {
  arrival: string | null;
  departure: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
}

/**
 * The stay to ask about, or null when it is not set: both dates valid, the departure after
 * the arrival, at most 30 nights (the date picker's limit, so a longer stay can only come from
 * an edited URL), and at least one adult. With no guests chosen yet the party is 1 adult, as
 * on a place's page (E2).
 */
export function exploreStay(params: ExploreStayParams): StayQuery | null {
  const { arrival, departure } = params;
  if (!arrival || !departure || !isCalendarDate(arrival) || !isCalendarDate(departure)) {
    return null;
  }
  if (compareDates(departure, arrival) <= 0 || nightsBetween(arrival, departure) > MAX_NIGHTS) {
    return null;
  }
  const adults = params.adults ?? 1;
  if (!(adults >= 1)) return null;
  return {
    arrival,
    departure,
    adults,
    children: params.children ?? 0,
    infants: params.infants ?? 0,
  };
}
