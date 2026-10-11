// Application-wide constants

export const APP_NAME = 'WA Stay';
/** The tagline: package.json's `description`, which the installer and Linux packages show. */
export const APP_DESCRIPTION = 'Find and book places to stay across Western Australia';
export const APP_REPO_URL = 'https://github.com/wilsonwaters/wa-stay';
export const APP_ISSUES_URL = `${APP_REPO_URL}/issues`;

// Watch check intervals (minutes, PQ6). The renderer offers exactly these; the scheduler never
// checks a watch more often than every 15 minutes (a legacy shorter value is run at 15).
export const WATCH_INTERVAL_OPTIONS = [15, 30, 60, 240, 720, 1440] as const;
export const DEFAULT_WATCH_INTERVAL = 60;
export const MIN_WATCH_INTERVAL_MINUTES = 15;

// Site Sniper
export const DEFAULT_SNIPE_POLL_INTERVAL_MS = 1500;
export const MIN_SNIPE_POLL_INTERVAL_MS = 500;
export const MAX_SNIPE_POLL_INTERVAL_MS = 60000;
export const DEFAULT_SNIPE_LEAD_TIME_SECONDS = 120;
export const DEFAULT_SNIPE_WINDOW_MS = 900000; // 15 min
export const CANCELLATION_POLL_MIN_MS = 3000; // politeness floor for continuous cancellation polling

// Retention: the default for the `retention.*` settings (the scheduler's retention job)
export const NOTIFICATION_RETENTION_DAYS = 30;
