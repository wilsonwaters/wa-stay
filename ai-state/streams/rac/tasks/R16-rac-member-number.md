# R16: RAC member number and member rates

## Description
As an RAC member, I can save my own member number once in Settings → Accounts, so WA Stay times my release alerts to the members' pre-sale (48 h before the public release), shows me member rates, and gives me a copy button when I book or pay on RAC's site.

R15 builds the generic `credentials` sign-in: the form, `accounts.saveCredentials`, `accounts.copyCredential` and the vault. This task gives RAC its `credentials` auth and makes RAC's modules member-aware. Terms rules 11, 12 and 14 apply (`ai-state/research/rac-terms.md`). The number is never logged, never returned to the renderer and never sent anywhere by the app (brief RO4). The person types it at RAC's own checkout.

## Size
M

## Depends on
R11 (the bulk search whose tariff rule changes), R13 (the alerted-snipe panel that gets the copy button), R14 (release policy and calendar), R15 (credentials accounts)

## Scope
1. **RAC's auth** (`src/main/providers/rac/auth.ts`, wired in RAC's factory):
   - `kind: 'credentials'`. The manifest's `capabilities.account` becomes `'optional'` (R5 shipped `'none'`). Nothing waits on it: `ensureForHolds` stays a no-op.
   - One field: `{ key: 'memberNumber', label: 'RAC member number', secret: true }`, with help text: "On your RAC card or in myRAC. Kept encrypted on this computer and never sent. You type it at RAC's checkout." It sets `copyable: true` (R15's flag).
   - `confirmations` (rule 11; booking policy 8.3–8.5): "This is my own RAC member number", "I will stay at the park myself", "I will book in the name on my RAC card". R15 refuses a save without all three.
   - `signIn(values)`: a local format check only, with **no request**. Spaces and hyphens are ignored (RAC's checkout strips `-`), then 4–16 digits are required. Otherwise it refuses with "That doesn't look like an RAC member number".
   - `isSignedIn`: `signed-in` when a number is saved, else `signed-out`. No request.
2. **Membership as a boolean** (`providers/rac/membership.ts`): `hasMemberNumber(ctx)` reads `ctx.secrets.get('account.memberNumber')` and returns only whether it is set. Every RAC module asks it. No other RAC file reads the secret (a source guard checks this). An unreadable secret (`SecretUnreadableError`) counts as no number, with a warning that names no value.
3. **Tariffs** (R10's mapping, `providers/rac/`):
   - `isMemberTariff(tariff)`: a tariff for RAC members, by its label or short description ("RAC Member Rate", "Exclusive to RAC WA members", "… - RAC Member"). One classifier, tested on every tariff in the fixtures.
   - **Without a number** (rule 14), a stay is free only through a bookable non-member tariff. Its price is the cheapest bookable non-member tariff.
   - **With a number**, member tariffs count too. The price is the cheapest bookable tariff. When that is a member tariff, `priceNote: 'RAC member rate'` (R8). When only member tariffs are bookable (a pre-sale, RS8), the stay is free.
   - The same rule applies everywhere: `availability.check`, bulk `availability.search` (`byKind` too), and so watch matching and `maxPrice`.
4. **Release instants** (R14's policy): R16 feeds `hasMemberNumber` into R14's school-holiday computation. With a number, at a park and category that take part, the pre-sale instant applies. Otherwise the public one. Cable Beach, Ningaloo and Margaret River dorms never move. `release.opensAt` from `availability.check` follows the same rule.
5. **Links:** `links.booking` (the prefilled book-now page) sets `membership_type=member` when a number is saved, else `non-member`. The number itself never goes in a link.
6. **When the number changes** (save, replace, remove), wired through R15's `onCredentialsChanged` hook in the container (`src/main/app/container.ts`), never from the provider:
   - RAC's cached availability is dropped: the catalogue's bulk and per-location caches for RAC in main, and RAC's availability queries in the renderer (on `account:updated`);
   - snipes are re-armed (`JobScheduler.rescheduleAll()`, `job-scheduler.ts:126`), so a `daily_rollover` snipe asks for its instant again at its next arm (`snipe-runner.ts:300-307`).
7. **Copy button** (renderer, provider-neutral, `components/accounts/CopyCredentialButton.tsx`): "Copy {field label}". It sits beside "Book on {shortName}" (`features/place/StayCard.tsx`, the watch page's link from R7, an alerted snipe from R13) and beside "Pay now" (`components/stay/HoldPanel.tsx`). It shows when the provider's account has a saved copyable field (`savedFields`, R15). It calls `accounts.copyCredential({ providerId, key })`. The value never reaches the renderer.

## Non-goals
- The generic credentials form, `accounts.saveCredentials`, `accounts.copyCredential` and vault storage (R15).
- The school-holiday calendar, the release modes and `release.opensAt` itself (R14). Rendering `priceNote` and minimum stays (R8).
- Auto-cart (R19). Rule 13 (at most two member bookings per period) is enforced there.
- Checking a number with RAC or NewBook: never (rule 12).
- User docs, the providers README and the website (R20).

## Completion Criteria
- [ ] `tests/unit/providers/rac/auth.test.ts`: one secret field, three confirmations; accepts `1234 5678` and `1234-5678`, refuses `abc` and `12`; `signIn` and `isSignedIn` send **no request** (an `HttpClient` fake that fails the test on any call).
- [ ] RAC's manifest test: `capabilities.account === 'optional'`; the registry accepts `auth.kind === 'credentials'`; RAC's contract suite passes.
- [ ] `tests/integration/rac-member-number.test.ts` (rule 12, RO4). It uses the number `98765432`, saved through `accounts.saveCredentials`, and checks that neither `98765432` nor `9876-5432` appears in:
  - any RAC request's URL, query, headers or body: a catalogue `get`, a check, a bulk search, `computeReleaseAt`;
  - any captured log line (logger fake);
  - any IPC answer: `accounts.list`, `accounts.status`, `providers.list`, `catalog.checkLocation`, `catalog.get` (IPC harness);
  - the text of a watch alert notification or its email.
- [ ] Rule 14, on a fixture where the standard tariffs are sold out and the member tariff is bookable. Without a number: `fullyAvailable: false` and bulk `availableUnits: 0`. With a number: free, with `priceNote: 'RAC member rate'`.
- [ ] Prices on the Busselton fixture (`availability-busselton-2026-11-06-2n.json`, powered site). Without a number: 75 a night, 150 in total, no note. With a number: 68 a night, 136, `priceNote: 'RAC member rate'`.
- [ ] Fake-clock release tests, for a stay in the Dec 2027 school holidays:
  - Busselton without a number: 5 Feb 2027 08:00 AWST;
  - Busselton with a number: 3 Feb 2027 08:00 AWST;
  - Cable Beach, and a Margaret River dorm, with a number: unchanged.
- [ ] Removing the number while an RAC snipe is armed succeeds: no `ACCOUNT_BUSY`, and RAC's session partition is not cleared (R15's rule).
- [ ] Core harness test: an armed snipe re-arms after the number is saved (now the pre-sale instant) and again after it is removed (back to the public instant). After a change, the next check asks RAC again instead of answering from the cache.
- [ ] Source guard: under `src/main/providers/rac/`, only `membership.ts` and `auth.ts` name `account.memberNumber`.
- [ ] `links.booking` with and without a number: `membership_type` is `member` or `non-member`, and the digits never appear.
- [ ] Renderer tests for the copy button:
  - shown on StayCard, HoldPanel, the watch page and an alerted snipe when a copyable field is saved, and hidden otherwise;
  - a click sends `providerId` and `key` only;
  - success is announced, and failure shows an error.
- [ ] E2E `tests/e2e/rac-member-number.spec.ts` (`providers: ['parkstay', 'rac']`):
  - in Settings → Accounts → RAC, Save stays disabled until all three boxes are ticked;
  - after saving, "Member number saved" shows, the input is empty and the number is nowhere in the page;
  - an RAC place page shows "Copy RAC member number" beside "Book on RAC", and clicking it puts the number in the clipboard (`electronApp.evaluate(({ clipboard }) => clipboard.readText())`);
  - after Remove, the button is gone.
- [ ] A11y:
  - the copy button's accessible name is "Copy RAC member number": no value in the name, the title or a tooltip;
  - "RAC member number copied" is announced through `useAnnounce`, and focus stays on the button;
  - with RAC's descriptor, R15's form gives the field a password-style input whose label and help are linked (`aria-describedby`), and each confirmation is a labelled checkbox.
- [ ] CLAUDE.md "Secrets": RAC's member number is a provider secret, write-only over IPC, copied by main. The e2e journey count in CLAUDE.md and `tests/README.md`.
- [ ] Full gate: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`.

## Edge Cases
- **Unreadable secret** (data copied to another computer): it counts as no number, with public instants and prices. Settings shows R15's "enter it again" state.
- **Number saved during a pre-sale** (the member instant has passed, the public one has not): the re-armed snipe polls if it is still inside its window. Otherwise it ends EXPIRED with the existing message. Tested.
- **Number removed while a snipe is ARMED for the pre-sale:** it re-arms for the public instant.
- **Member tariff refused** (codes 5, 6, 8, 11) while the standard one is bookable: free at the standard price, with no note.
- **Only a member promotion is bookable** ("Stay & Save … - RAC Member"): free with a number, noted "RAC member rate".
- **Placeholder totals** on refused tariffs (`999`) are never a price.
- **Removing is never refused** (no `ACCOUNT_BUSY`), even while an RAC snipe is armed, and never clears RAC's session partition (R15's rule). The number goes, the copy button disappears, and armed snipes re-arm for the public instant.
- **Clipboard write fails:** an error shows, and nothing is logged with the value.
- **Replace twice quickly:** the last save wins. Caches drop and snipes re-arm each time, without errors.
- ParkStay's cached availability and its snipes' instants are untouched by an RAC change.

## Test Strategy
- **Unit (~22):** auth (format, no request); `isMemberTariff` over every fixture tariff; the tariff matrix (number × tariff states); links; `hasMemberNumber` with an unreadable secret; the source guard.
- **Component (~6):** the copy button in its four places; the announcement; hidden without a saved field.
- **Integration (~8):** the number never leaves (requests, logs, IPC, notifications); fake-clock instants; cache drop and re-arm through the core harness.
- **E2E (1 journey):** save, copy, remove.

## Context Files to Read First
- `CLAUDE.md` ("Secrets", "IPC Pattern", "Adding a provider" rules)
- `ai-state/streams/rac/master-plan.md` (decisions 3, 5, 6; terms table rows 11, 12, 14; RS8)
- `ai-state/streams/rac/tasks/R15-credentials-accounts.md`, `R14-rac-release-policy.md`, `R10-rac-availability-watches.md`
- `ai-state/research/rac-booking-flow.md` §3, §5; `ai-state/research/rac-terms.md` §5, rules 11–14
- `ai-state/research/rac-samples/availability-busselton-2026-11-06-2n.json`
- `src/main/providers/sdk/provider.ts` (`CredentialsAuth`), `src/main/providers/sdk/secrets.ts`
- `src/main/core/accounts/provider-account.service.ts`, `src/main/app/container.ts`
- `src/main/core/catalog/location-catalog.service.ts` (`bulkCache`, `checkCache`), `src/main/scheduler/job-scheduler.ts`, `src/main/scheduler/snipe-runner.ts`
- `src/renderer/features/place/StayCard.tsx`, `src/renderer/components/stay/HoldPanel.tsx`, `src/renderer/api/accounts.ts`, `src/renderer/features/bookings/detail/CopyReference.tsx` (copy pattern)

## Notes
- The number reaches RAC only when the person types or pastes it at RAC's checkout ("Existing RAC member" → "Member Number"). WA Stay never fills that field, not even in its payment window: no script of ours runs there (`provider-windows.ts:9-12`).
- With a number, the app shows the price RAC charges a verified member. RAC checks the number against the name at checkout and on arrival (booking policy 8.4).

## Assumptions
- RAC member numbers are 4–16 digits once spaces and hyphens are removed. The format is unconfirmed. The stakeholder should try their own card (RS13); loosen the check if it refuses a real number.
- Member tariffs are recognised by their wording, since the response has no "members only" flag (seen in the samples). If RAC renames them, prices fall back to non-member tariffs: wrong but safe.
- Re-arming every snipe with `rescheduleAll()` is cheap enough. A re-arm only re-asks instants; it sends a request only for snipes that need one at arm time.
- Pre-sale availability is unseen (RQ3). RS8's default applies: with a number, any free night counts.
