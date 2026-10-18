# RI11: Docs, website and release notes

## Description

Describe Rottnest truthfully everywhere a person or a contributor reads about WA Stay. The message is reminders, rules and links, not availability. The final gate runs here.

## Size

M.

## Depends on

- All other tasks.

## Scope

1. **`docs/providers/rottnest/`:**
   - **README:** what the module does and why it is links-only (clause 4, in plain words, linking RIA's terms PDF), the precincts and unit types, links, rules, Open Day plans, look reminders and their reasons, and what it will never do.
   - **`open-days.md`:** the calendar's upkeep, modelled on RAC's `release-calendar.md`:
     - where RIA publishes (the booking-guide index, each month's guide, the Open Days page);
     - what to copy into `open-days.ts`, `booking-guides.ts` and `public-holidays.ts`;
     - the tests to extend;
     - what happens past `CALENDAR_CONFIRMED_UNTIL`.

     Every source is read by hand in a browser; nothing in WA Stay fetches it.
   - **`rules.md`:** each rule, its source (guide and clause) and how it is checked.
   - **No internal plan references:** the docs test bars task ids and the brief.
2. **`docs/providers/adding-a-provider.md`:** RI1's "Links-only providers" section, checked against the final API (`stayRules`, `release.reminders`, `reminders.next`).
3. **`docs/providers/README.md`:** the Rottnest row.
4. **Feature docs:**
   - `docs/watches-and-notifications.md`: look reminders;
   - `docs/site-sniper.md`: Open Day plans;
   - `docs/user-guide.md`: Rottnest;
   - `docs/security.md`: "WA Stay sends no request to Stay Rottnest", with the refusing client.
5. **CLAUDE.md:**
   - the project overview names the third provider;
   - the manifest bullet (`integration: 'links'`), the SDK modules (`stayRules`, `reminders`, `release.reminders`, `release.checklist`) and the IPC table (`catalog.stayRules`, `watches.recordLook`);
   - the Key Services rows (WatchService and SiteSniperService reminder modes; a Rottnest provider row);
   - the test guards list;
   - step 1 of "Adding a provider".
6. **CHANGELOG `[Unreleased]`:** Rottnest Island: Open Day plans, look reminders, rules and links; WA Stay never contacts Stay Rottnest.
7. **Website** (`site/`), per CLAUDE.md "Website":
   - **Providers row:**
     - `data-provider="rottnest"`, the manifest name "Stay Rottnest" and the monogram "SR";
     - "Reminders for Rottnest's Open Days and for when cancellations are likely, with RIA's booking rules. WA Stay doesn't contact Stay Rottnest: you search and book on its site.";
     - `--provider-rottnest` and the badge rule.
   - **Independence notice:** add "the Rottnest Island Authority (Stay Rottnest)".
   - **"Booked out? Set a watch":** check the copy still holds when one provider reminds rather than checks. Add a line if it claims every provider is checked.
   - **"Questions":** "Can WA Stay book Rottnest for me?" "No. Rottnest's booking terms don't allow automated booking or checking. WA Stay reminds you and opens Stay Rottnest's site."
   - **"Coming next":** Site Sniper stays "Soon"; mention Open Day plans there.
   - **Screenshots:** retake them (`npm run site:screenshots`, with a Mapbox token) only if a shown screen changed. A Rottnest card in the Explore hero would change it.
8. **The final gate:**
   - `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`;
   - `npm run build:e2e && xvfb-run -a npm run test:e2e`;
   - the Rottnest preview.

   Also run **a request-log audit over the whole e2e run**: no host under `stayrottnest.com`, `rottnestisland.com` or `ria.wa.gov.au`.

## Completion criteria

- [ ] Docs, CLAUDE.md, CHANGELOG and the site updated. The docs and site tests pass: links, the provider row against the manifest, colours from tokens.
- [ ] The final gate and the request-log audit pass.
- [ ] The stakeholder actions are listed in the PR description: TQ1 (the deep link), TQ7 (the website terms), T2 (the letter to RIA), and the calendar's next upkeep date.
