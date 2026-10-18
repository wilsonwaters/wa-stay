# The website

WA Stay's public website is a single static page in [`site/`](../site/index.html): plain HTML,
CSS and one small script, with no build step and no framework. It is for people deciding whether
to use WA Stay, so it says what the app does in plain words and never describes how it is built
(that is what the repository and these docs are for).

## Contents

- [Where it is published](#where-it-is-published)
- [Turning it on](#turning-it-on)
- [A custom domain](#a-custom-domain)
- [Previewing changes](#previewing-changes)
- [Screenshots](#screenshots)
- [Keeping it in step with the app](#keeping-it-in-step-with-the-app)
- [Rules for the page](#rules-for-the-page)

## Where it is published

[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) uploads `site/` to GitHub Pages
whenever a push to `main` changes `site/` (or the workflow), and on demand from the Actions tab
(**Website**, then **Run workflow**). Until a custom domain is set, the address is
<https://wilsonwaters.github.io/wa-stay/>.

Every link to the site's own files is relative, so the page works both under `/wa-stay/` and at
the root of a custom domain. The download and footer links go to the project on GitHub.

An address like `wa-stay.github.io` belongs to a GitHub account (a user or an organisation) named
`wa-stay`, not to a repository: a repository called `wa-stay.github.io` under that account would
serve it. The app's repository should stay where it is, because updates are published from it.
With a custom domain the `github.io` address no longer matters, so the project site above is the
simplest start.

## Turning it on

The download buttons link to the [latest release](https://github.com/wilsonwaters/wa-stay/releases/latest).
When that release has a `WA-Stay-Setup-x.y.z.exe` (the name `electron-builder.json` gives the
Windows installer), `site/site.js` shows its version and, on Windows, points the buttons straight
at it. Until 2.0.0 is published, the latest release is 1.2.0, the old app, so the buttons lead to
its release page. So, in this order:

1. **Publish 2.0.0** ([release process](release-process.md)).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**, in the repository on
   GitHub. A run of the workflow before this fails at "Configure Pages"; run it again afterwards.
3. **Actions → Website → Run workflow** (or merge a change to `site/`). The run's summary links
   to the published page.
4. **The repository's About panel** (the gear beside "About" on the repository's front page):
   set **Website** to the page's address, so people find it from GitHub.

The workflow only publishes. CI checks `site/` on every pull request: ESLint and Prettier cover
it, and `npm test` runs the site test below.

## A custom domain

For example `wastay.com.au` (a `.com.au` name needs an Australian business number or similar; a
direct `.au` name such as `wastay.au` needs only an Australian presence):

1. **Verify the domain** for your GitHub account first: **Settings → Pages → Add a domain**, in
   your account settings rather than the repository's. GitHub shows a `TXT` record named
   `_github-pages-challenge-wilsonwaters.<domain>`; add it at the registrar, wait for it to
   appear, then choose **Verify**. This stops anyone else's repository from claiming the domain.
2. **DNS, at the domain's registrar:**
   - the bare domain (`wastay.com.au`): `A` records to `185.199.108.153`, `185.199.109.153`,
     `185.199.110.153` and `185.199.111.153`, and `AAAA` records to `2606:50c0:8000::153`,
     `2606:50c0:8001::153`, `2606:50c0:8002::153` and `2606:50c0:8003::153`;
   - `www`: a `CNAME` to `wilsonwaters.github.io`.
3. **The repository's Settings → Pages → Custom domain:** enter the domain and save. Once the
   certificate is issued, tick **Enforce HTTPS**. Deploying from Actions needs no `CNAME` file
   in `site/`.
4. **In `site/index.html`**, change the `og:image` address (the picture shown when the page is
   shared) to the new domain, and update the address at the top of `pages.yml` and in this
   page.

The old `github.io` address then redirects to the domain.

## Previewing changes

Serve `site/` with any static server and open it, for example:

```bash
npx http-server site -p 8000      # or: python -m http.server --directory site 8000
```

Then open <http://localhost:8000>. Check it at a phone width as well as a desktop one.
`npm test` runs [`tests/unit/site/site.test.ts`](../tests/unit/site/site.test.ts). It checks
that every link, image and anchor resolves, every image has alt text and a size, nothing loads
from another site, the colours equal the app's tokens, and the fonts, logo and brushstrokes are
unchanged copies of the app's own.

## Screenshots

The screenshots in `site/assets/screens/` come from the built app in fixture mode. ParkStay's
recorded catalogue and example availability for 10–12 Nov 2026 stand in for live data. The map is
Mapbox's, and the places' photos are the providers' own; both are loaded live, anonymously, while
the screenshots are taken. Every other request is answered from the fixtures. They show no
provider documents, such as campground maps. They show ParkStay WA only (the run registers no
other provider), so they never show RAC Parks & Resorts' places or photos: RAC's terms limit
its photos and copy to a person's own use, so they appear only in the app.

`npm run site:screenshots` rebuilds and retakes them; it needs a Mapbox token. Retake them when a
screen they show changes, then update each image's size and alt text in `site/index.html`.
Without a token at hand, the **Screenshots** workflow (`.github/workflows/screenshots.yml`)
retakes these and the documentation's screenshots with the repository's token: run it from the
Actions tab, or add the `screenshots` label to a pull request, then review the images in its
`screenshots` artifact and commit them. It pushes nothing itself.

## Keeping it in step with the app

The page describes the app, so a change to what the app does or shows changes the page in the
same pull request ([CLAUDE.md, "Website"](../CLAUDE.md#website) has the list). In particular:

- **A provider ships:** add its row to the providers list ("Different providers, one app"), with
  `data-provider="<id>"`, its manifest name and monogram, and what WA Stay does with it. Add its
  brand colour as `--provider-<id>` in `site/styles.css`, with a
  `[data-provider='<id>'] .provider__badge` rule. The site test checks the row against the
  manifest.
- **A "Soon" feature ships:** move it out of "Coming next" into a section of its own, with a
  screenshot.
- **A claim changes**, such as watch intervals, holds, accounts, what data leaves the computer, or
  supported Windows versions: update the copy and the questions that mention it.
- **A screen the screenshots show changes:** retake them (above).

The site test catches broken links, wrong image sizes, colours outside the app's tokens, loads
from other sites and provider rows that don't match a manifest. It cannot catch copy that has
gone stale: read the page against the change.

## Rules for the page

- **The app's design language applies** ([design language](design/design-language.md)): the
  palette (the colours are copied from `tokens.css`, and the test keeps them equal), Fraunces
  only at display sizes, coral only for the one main button in a view, one brushstroke (the
  hero's underline), and no gradients, glass or emoji.
- **Say only what is true**, in the app's voice: Australian English and sentence case, with
  "checks as often as every 15 minutes" rather than "never miss a site". A feature still marked
  "Soon" in the app is described as coming, never as available.
- **Provider-neutral copy.** WA Stay brings different providers into one app, so the copy speaks
  of places, sites and providers. A provider is named only in its providers row and in the
  independence notice: WA Stay is not made by or affiliated with the providers it shows
  (including DBCA, which runs ParkStay WA, and RAC, which runs RAC Parks & Resorts) or with
  Tourism WA, and it is not a government service. Nothing of a provider's own goes on the page
  but what the screenshots show: no logo (a provider's badge is its monogram on its colour) and
  no marketing copy.
- **Nothing from another site.** Fonts, images and the script are files in `site/`, and the
  page sets no cookies and has no analytics. The only outside request is the script's call to
  GitHub for the latest release, which the page's Content-Security-Policy allows and nothing
  else. The fonts' licences (SIL Open Font License) are next to them in `site/assets/fonts/`.
