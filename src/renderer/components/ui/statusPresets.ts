import {
  Ban,
  BellRing,
  CalendarClock,
  CalendarX,
  CircleAlert,
  CircleCheck,
  CirclePause,
  CircleX,
  Clock,
  Hourglass,
  Search,
  Timer,
  TriangleAlert,
} from 'lucide-react';
import { BookingStatus, SnipeResult, SnipeStatus, WatchResult } from '@shared/types';
import type { StatusPillProps } from './StatusPill';

export type StatusPreset = Pick<StatusPillProps, 'tone' | 'icon' | 'label' | 'live'>;

/**
 * StatusPill props for every status the app shows, keyed by the enums in `src/shared/types`.
 * Use `<StatusPill {...statusPresets.snipe[snipe.status]} />`. A test fails if an enum value
 * has no preset.
 */
export const statusPresets = {
  /** A watch's own state: running or paused. */
  watch: {
    active: { tone: 'brand', icon: BellRing, label: 'Watching', live: true },
    paused: { tone: 'neutral', icon: CirclePause, label: 'Paused' },
    /** The stay has started or passed: nothing left to watch. */
    ended: { tone: 'neutral', icon: CalendarX, label: 'Ended' },
  },
  /** The outcome of a watch's last check. */
  watchResult: {
    [WatchResult.FOUND]: { tone: 'available', icon: CircleCheck, label: 'Sites found' },
    [WatchResult.PARTIAL_FOUND]: {
      tone: 'warning',
      icon: TriangleAlert,
      label: 'Some nights found',
    },
    [WatchResult.NOT_FOUND]: { tone: 'neutral', icon: Search, label: 'Nothing yet' },
    [WatchResult.HELD]: { tone: 'warning', icon: Timer, label: 'Site held' },
    [WatchResult.BOOKED]: { tone: 'available', icon: CircleCheck, label: 'Booked' },
    [WatchResult.ERROR]: { tone: 'danger', icon: CircleAlert, label: 'Check failed' },
  },
  snipe: {
    [SnipeStatus.ARMED]: { tone: 'brand', icon: CalendarClock, label: 'Armed' },
    [SnipeStatus.WAITING_RELEASE]: { tone: 'sun', icon: Clock, label: 'Waiting for release' },
    [SnipeStatus.QUEUEING]: { tone: 'sun', icon: Hourglass, label: 'In the queue', live: true },
    [SnipeStatus.SNIPING]: { tone: 'brand', icon: Search, label: 'Trying now', live: true },
    [SnipeStatus.HELD]: { tone: 'warning', icon: Timer, label: 'Site held' },
    [SnipeStatus.BOOKED]: { tone: 'available', icon: CircleCheck, label: 'Booked' },
    [SnipeStatus.FAILED]: { tone: 'danger', icon: CircleAlert, label: 'Failed' },
    [SnipeStatus.EXPIRED]: { tone: 'neutral', icon: CircleX, label: 'Expired' },
    [SnipeStatus.DISABLED]: { tone: 'neutral', icon: CirclePause, label: 'Paused' },
  },
  /** The outcome of a snipe attempt. */
  snipeResult: {
    [SnipeResult.PENDING]: { tone: 'neutral', icon: Clock, label: 'Pending' },
    [SnipeResult.HELD]: { tone: 'warning', icon: Timer, label: 'Site held' },
    [SnipeResult.BOOKED]: { tone: 'available', icon: CircleCheck, label: 'Booked' },
    [SnipeResult.UNAVAILABLE]: { tone: 'neutral', icon: Ban, label: 'Not available' },
    [SnipeResult.TOO_EARLY]: { tone: 'sun', icon: Clock, label: 'Not released yet' },
    [SnipeResult.QUEUE_FULL]: { tone: 'warning', icon: Hourglass, label: 'Queue full' },
    [SnipeResult.EXPIRED]: { tone: 'neutral', icon: CircleX, label: 'Expired' },
    [SnipeResult.ERROR]: { tone: 'danger', icon: CircleAlert, label: 'Error' },
  },
  booking: {
    [BookingStatus.CONFIRMED]: { tone: 'available', icon: CircleCheck, label: 'Confirmed' },
    [BookingStatus.PENDING]: { tone: 'warning', icon: Clock, label: 'Pending' },
    [BookingStatus.CANCELLED]: { tone: 'neutral', icon: CircleX, label: 'Cancelled' },
  },
} satisfies {
  watch: Record<'active' | 'paused' | 'ended', StatusPreset>;
  watchResult: Record<WatchResult, StatusPreset>;
  snipe: Record<SnipeStatus, StatusPreset>;
  snipeResult: Record<SnipeResult, StatusPreset>;
  booking: Record<BookingStatus, StatusPreset>;
};
