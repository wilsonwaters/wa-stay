# Technical review (pre-refactor baseline)

## Architecture summary
1. Composition root src/main/index.ts:106-161 wires by hand; registerIPCHandlers takes 12 positional args (5 optional) (ipc/index.ts:31-44). No container.
2. Two repository styles: injected db (User, Booking, Settings, NotifProvider) vs global getDatabase() (Watch, SiteSnipe, Notification) created inside services (watch.service.ts:17, sitesniper.service.ts:37, notification.service.ts:27).
3. DB: one SQLite file in userData; v1 schema inlined as SCHEMA_SQL then migrations v2–v6; migrations not wrapped in transactions.
4. ParkStayService only integration (axios + spoofed Chrome headers). Production-used: searchCampgrounds, checkAvailability (Watch); getSiteAvailabilityView, createBookingHold (Sniper). Watch & Sniper use different availability models (CampsiteAvailability vs SiteAvailabilityEntry).
5. Scheduler: watches on node-cron (Australia/Perth); snipes on setTimeout/setInterval state machine ARMED→QUEUEING→WAITING_RELEASE→SNIPING→HELD/EXPIRED.
6. Notifications: NotificationService (DB + OS toast) → NotificationDispatcher → providers (SMTP only). Plugin pattern worth copying.
7. IPC: ~70 invoke channels, one handler file/domain, APIResponse{success,data,error}. Only queue + updater push events.
8. Preload: flat window.api, 11 namespaces typed via typeof api. Listeners have no unsubscribe. Preload compiled by tsc and requires shared code → sandbox:false.
9. **ParkStay authentication NOT implemented.** All requests anonymous. Gmail OTP + OAuth code exists but not wired to any login flow.
10. Single user everywhere (getFirstUser; renderer supplies userId).

## Entities
| Entity | Columns | ParkStay-specific |
|---|---|---|
| users | id, email, encrypted_password, encryption_key, encryption_iv, encryption_auth_tag, first_name, last_name, phone, created/updated_at | email/password = ParkStay login (ParkStay doesn't use passwords; magic link). encryption_key written, never used. |
| bookings | id, user_id, booking_reference UNIQUE, park_name, campground_name, site_number, site_type, arrival/departure_date, num_nights, num_guests, total_cost, currency, status, booking_data JSON, notes, created/updated/synced_at | park/campground hierarchy, site_type (gear_type), booking_data (ParkStayBookingData). Unique must become (provider, reference). No provider_id. |
| watches | id, user_id, name, park_id, park_name, campground_id, campground_name, dates, num_guests, preferred_sites JSON, site_type, check_interval_minutes, is_active, last/next_check_at, last_result, found_count, auto_book, notify_only, max_price, notes, last_availability (v2), allow_partial_match (v5), timestamps | park_id, campground_id, preferred_sites, site_type |
| site_snipes | id, user_id, name, campground_id/name, target_site_ids, site_type, dates, num_adult/concession/child/infant/vehicle, postcode, release_mode, release_at, queue_enabled, lead_time_seconds, poll_interval_ms, window_duration_ms, status, is_active, attempts_count, max_attempts, last/next_check_at, last_result, last_error, held_booking_pk, held_expires_at, payment_url, booked_reference, notes, timestamps | nearly all |
| notifications | id, user_id, type CHECK(...), title, message, related_id, related_type CHECK(booking,watch,stq,snipe), action_url, is_read, created_at | CHECK lists force rebuilds; 'stq' legacy |
| settings | key, value, value_type, category, description, updated_at | generic, no provider namespace |
| queue_session | singleton DBCA queue session | all |

## Top findings
1. CRITICAL connection.ts:394-418 migration 006 broke notification_delivery_logs: ALTER TABLE notifications RENAME → SQLite 3.26+ rewrites FK in notification_delivery_logs to "notifications_old" which is dropped. Every insert fails `no such table: main.notifications_old` (fresh installs too). notification-dispatcher.ts:455 throws, catch's second logDelivery (481) throws again → aborts dispatch to remaining providers. Fix: v7 rebuild of logs table (create new, copy, drop old, rename); wrap migrations in transactions; PRAGMA foreign_key_check tests.
2. HIGH job-scheduler.ts:176,268 snipe ticks overlap (setInterval 1.5s, no in-flight guard, execute() can wait 30s HTTP or forever on queue; guard at sitesniper.service.ts:198 reads status written after wait) → multiple holds. Fix: per-snipe mutex, chained setTimeout, AbortController.
3. HIGH parkstay.service.ts:112-124 cookies captured only when this.session exists — never (login posts to non-existent /auth/login, setSession never called). Holds bound to throwaway session; payment link generic /booking/ (sitesniper.service.ts:238). Fix: cookie jar per provider account + payment hand-off sharing cookies with a browser session.
4. HIGH index.ts no app.requestSingleInstanceLock() → two schedulers on one DB.
5. HIGH security: plaintext secrets returned over IPC (auth.handlers.ts:130 password, gmail.handlers.ts:62 OAuth client secret, notification-provider.handlers.ts:26-70 SMTP password); GMAIL_GET_RECENT_EMAILS exposes inbox; no CSP; sandbox:false (index.ts:59); no window-open/navigation guards; no IPC sender validation. Fix: hasSecret flags, bundle preload, sandbox:true, CSP, check event.senderFrame.
6. HIGH security: encryption = obfuscation (PBKDF2(machineId + constant), static salt; AuthService.ts:13,218-224; notification-provider.repository.ts:21,400-406; oauth2-handler.ts:32 hard-coded electron-store encryptionKey). Fix: Electron safeStorage wrapping, versioned envelope.
7. MEDIUM tests: better-sqlite3 ABI mismatch (CI rebuilds); coverage 22.8%; 0% job-scheduler, IPC handlers, dispatcher, SMTP, Gmail; parkstay.service 1.7%; jest uses jsdom for main tests; src/setupTests.ts mocks window.electron (app uses window.api) and silences console.error/warn; tests/setup.ts dead; brittle: queue.test fake timers, watch.schema.test real "tomorrow".
8. MEDIUM Gmail OAuth loopback (oauth2-handler.ts:159-254): no state/PKCE; listen(0) all interfaces; getToken(code) missing redirect URI vs client built with localhost:3000/oauth2callback (gmail.handlers.ts:38).
9. MEDIUM logging (logger.ts:13-28): log dir resolved before app ready → os.tmpdir(); "Open logs folder" opens empty userData/logs; 79 console.* in main; winston exitOnError + index.ts:228 quit on uncaughtException kills snipes.
10. MEDIUM queue.service.ts:338 emits 'error' without listener → ERR_UNHANDLED_ERROR; pollUntilActive (263-290) can't time out/cancel; shared keep-alive stopped by first snipe to finish (job-scheduler.ts:289,313).
11. MEDIUM scheduler: watch intervals ≤60 min always run hourly (job-scheduler.ts:114) while DB default 5 min; next_check_at unused; startWarmup grabs timers before await; no powerMonitor resume; stale snipe closures.
12. MEDIUM two base repositories (BaseRepository.ts vs base.repository.ts); findWhere(condition) string API + interpolated enums (site-sniper.repository.ts:130,140) SQL-injection prone.
13. MEDIUM no runtime validation in IPC (zod only in renderer); watch/snipe/notification handlers trust renderer userId (watch.handlers.ts:17).
14. MEDIUM calendar dates stored as ISO timestamps (watch.repository.ts:232); mixed toISOString().slice vs local getDate(); watches deactivate 08:00 AWST on arrival day (watch.service.ts:100). Fix: YYYY-MM-DD strings, per-provider timezone.
15. LOW–MED preload listens on notificationCreated/watchResult/snipeStatusUpdate/bookingUpdated, main never sends (preload/index.ts:285-301); notification stubs no-op (notification.service.ts:261-281); "Auto-book" checkbox no-op (watch.service.ts:199); unbounded parallel campsite-name lookups (parkstay.service.ts:457); cookie parsing split('=') truncates (117,172).

## Dead/duplicate code
base.repository.ts + BaseRepository.ts; schema.sql (unreferenced); skip_the_queue_entries table + trigger + stq CHECK values; job_logs never written (JobType.SNIPE would fail CHECK); ParkStayService login/logout/validateSession/createBooking/getBookingDetails/cancelBooking/updateBooking/checkQueue/getCampsiteAvailability/get/setSession/setQueueService/legacy queueSession (~60% of 1,086 lines) + types BookingParams, RebookParams, QueueSessionInfo, ParkStaySessionToken; BookingService.importBooking/syncBooking placeholders, getBookingStats unused; SiteSniperService.runSnipeWindow; setBooked/notifySnipeBooked never triggered; JobScheduler.runCleanup no-op; connection.ts query/execute/transaction helpers; unused constants DB_NAME, APP_NAME, APP_VERSION(1.0.0), RATE_LIMIT_*, MAX_RETRIES*, REBOOK_*, MIN/MAX_WATCH_INTERVAL, MAX_CONCURRENT_WATCHES; AppSettings/settingsSchema unused in main; NotificationChannel.DESKTOP no provider; watch.schema.test-debug.ts; tests/setup.ts; ~15 stale status markdown files at repo root.

## Provider-plugin recommendations
- Interface: id, displayName, runtime 'http'|'browser', capabilities{search, availability, perUnitNights, hold, book, cancel, modify, importBookings, accessGate, releaseSchedule}; searchLocations/getUnits; checkAvailability(req, signal) → per-unit per-night normalised open|booked|closed|not_released (merges Watch+Sniper models); optional createHold → {ref, expiresAt}, getPaymentHandoff(hold) → {url, cookies}, list/cancel/modifyBooking; auth {kind none|password|magic-link|oauth|browser-session, login(ctx), validate()}; optional accessGate ensureAccess(signal)/keepAlive()/status events (DBCA queue → inside ParkStay module); optional releasePolicy computeReleaseAt; limits {minPollMs, maxConcurrency}; zod paramsSchema/configSchema.
- Provider context: HTTP client w/ cookie jar, Playwright persistent context per account (userData/providers/<id>), safeStorage secret vault, provider_state KV (replaces queue_session), child logger, clock, AbortSignal.
- Schema: provider_id, location_id/name, parent_location_name, unit_ids, params_json on bookings/watches/snipes; provider_accounts table; bookings unique (provider_id, reference); drop notification CHECKs.
- Generic core services call registry.get(providerId). One "notifier" plugin system.
- Naming clash: existing notification provider:* IPC channels + NotificationProvider* classes → rename to notifier.
- Typed IPC handle(channel, zodSchema, fn); events return unsubscribe.

## Rename risks
- package.json name "parkstay-bookings" → userData %APPDATA%\parkstay-bookings (installer.nsh customUnInstall confirms). Renaming orphans DB, gmail-oauth.json, localStorage, logs. Keep name or migrate folder before initializeDatabase (copy parkstay.db + -wal + -shm).
- connection.ts:435 hard-codes parkstay.db.
- Encryption constants must not change without decrypt/re-encrypt migration: AuthService.ts:13,:220 ('parkstay-salt'); notification-provider.repository.ts:21,:402; oauth2-handler.ts:31-32. Failed decrypt silently returns empty config (notification-provider.repository.ts:61-66).
- appId com.parkstay.bookings (NSIS GUID derived). Changing → side-by-side install, double schedulers, stale uninstall entry, notification ID (setAppUserModelId never called), stale auto-launch Run key (app.handler.ts:96-100). Keep appId or pin nsis.guid.
- productName sets install dir; installer.nsh hard-codes shortcut names and deletes $APPDATA\parkstay-bookings on uninstall-with-data (if new app reuses that folder, uninstalling old wipes it). Linux StartupWMClass must match.
- Auto-update: publish owner/repo at electron-builder.json:41-45,85-89,152-156,175-179; existing installs' app-update.yml points at parkstay-bookings → relies on GitHub redirect.
- Must NOT replace: QUEUE_GROUP 'parkstayv2', ParkStay URLs, sitequeuesession cookie.
- Safe: parkstay:* IPC channels, window title, email branding (email-smtp.provider.ts:99,146,258,336), temp log path.
