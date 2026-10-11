# ParkStay sign-in

How WA Stay signs a person in to ParkStay: an in-app window on ParkStay's own pages (a
`browser-session` sign-in). WA Stay never sees or stores a ParkStay password or code.

## The account is optional

ParkStay's manifest declares `capabilities.account: 'optional'`:

- DBCA's `create_booking` needs no sign-in (`api.py:2938-2947`), so Site Sniper and a watch's
  automatic hold work signed out.
- A ParkStay session lasts an hour (`SESSION_COOKIE_AGE = 3600`), far shorter than the wait
  for an overnight release, so requiring it when a snipe is armed would fail almost every
  snipe.
- When a hold is placed, the person pays in the payment window, which shows ParkStay's own
  sign-in when ParkStay asks for it. Connecting beforehand only makes checkout quicker.

Providers that declare `required-for-holds` or `required` are blocked until signed in
(`ProviderAccountService.ensureForHolds`, IPC code `AUTH_REQUIRED`); ParkStay never is.

The v1.x saved ParkStay password was never used by ParkStay and is not migrated: migration v9
drops it, and only the email carries over as a sign-in hint ([security](../../security.md)).

## Signing in

1. **Settings → Accounts → ParkStay WA → Connect** calls `accounts.signIn('parkstay')`. The
   button says "Waiting for sign-in…" until the window settles.
2. A sign-in window opens on the provider's session partition, `persist:provider-parkstay`,
   at `https://parkstay.dbca.wa.gov.au/ssologin` (`auth.ts`, `templates/ps/base.html:69`).
   The same partition carries the provider's HTTP client, so the session the window gets is
   the one availability checks, holds and the payment window use.
3. The flow goes through DBCA's SSO gateway (`auth2.dbca.wa.gov.au`) and Azure AD B2C
   (`dbcab2c.b2clogin.com`, sometimes `login.microsoftonline.com`). ParkStay emails a
   one-time code, which the person types into the window. If the email has a link
   instead, **Have a sign-in link?** under the account takes it: `accounts.openSignInLink`
   checks that it is on one of the sign-in origins and opens it in the window.
4. It ends at `https://parkstay.dbca.wa.gov.au/login-success/` (`urls.py:107`). That page also
   says "Session Expired" when sign-in failed, so the app confirms with a signed-in check
   ([below](#the-signed-in-check)) on arriving there, and every 3 s while the window shows
   ParkStay's own site. On the identity provider's and the queue's pages it does not ask.
5. Signed in, the window closes and the account shows "Signed in as <email>". If the person
   closes the window first, one more check makes sure a sign-in that just finished is not
   missed.

The DBCA queue can step in on ParkStay's pages. `https://queue.dbca.wa.gov.au` is allowed in
the window and counts as a waiting room (`access.waitingRoomOrigins`): when the queue lets the
person through to ParkStay's home page, the window goes back to the sign-in page.

### What the window allows

The window is the app's provider window (`src/main/app/provider-windows.ts`):

- top-level pages only on `parkstay.dbca.wa.gov.au`, `auth2.dbca.wa.gov.au`,
  `dbcab2c.b2clogin.com`, `login.microsoftonline.com` and `queue.dbca.wa.gov.au`
  (`PARKSTAY_SIGN_IN_ORIGINS`); anything else opens in the system browser;
- sandboxed, context-isolated, no Node, no preload or script of the app's, every permission
  request and certificate error refused, the pages' own CSP untouched;
- the title shows the host it is on, since there is no address bar;
- logs never carry a sign-in link's token, a cookie or the profile.

## The signed-in check

`isSignedIn` asks `GET https://parkstay.dbca.wa.gov.au/api/profile` (no trailing slash,
`urls.py:58`; `IsAuthenticated`, `api.py:4720-4731`) with the partition's cookies, within 15 s:

| Answer | Account state |
| --- | --- |
| 200 JSON with an `email` | `signed-in`, named `first_name last_name`. Only the email and the two names are read. |
| 401 or 403 (`{"detail":"Authentication credentials were not provided."}`, verified live 2026-10-10) | `signed-out` |
| The DBCA queue's page or a redirect to it, another status, a body that is not a profile, a timeout, no network | `unknown`, with a reason (`queue`, `http 503`, `network`…) |

`ProviderAccountService.status` stores only definite answers, so a busy evening on ParkStay
never signs anyone out in the app. Answers are cached for 60 s (5 s for `unknown`), and
concurrent callers share one request. A few seconds after start-up the app quietly checks
accounts not checked for 6 hours, and it checks once more after a payment window closes (the
person may have signed in while paying).

## Signing out

**Sign out** (after a confirmation) calls `accounts.signOut('parkstay')`. It clears the
partition's cookies, storage and HTTP auth cache and stores `signed-out`, keeping the email as
a hint. It touches nothing else: watches, snipes, bookings and the local profile stay. It is
refused with `ACCOUNT_BUSY` while a snipe is queueing, sniping or holding a site, or a watch's
hold has not expired, because signing out would lose the queue place or the hold.

## Still to check by hand

On the [release checklist](../../release-checklist-2.0.md):

- a real sign-in with the emailed code, and whether it survives a restart (the
  partition persists, but ParkStay's session lasts an hour);
- a real signed-in `/api/profile` answer;
- sign-in and payment while the DBCA queue is active;
- the hosts the payment window needs at the top level.
