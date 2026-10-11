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
- [Rules for the page](#rules-for-the-page)

## Where it is published

[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) uploads `site/` to GitHub Pages
whenever a push to `main` changes `site/` (or the workflow), and on demand from the Actions tab
(**Website**, then **Run workflow**). Until a custom domain is set, the address is
<https://wilsonwaters.github.io/wa-stay/>.

Every link in the page is relative, so it works both under `/wa-stay/` and at the root of a
custom domain.

An address like `wa-stay.github.io` belongs to a GitHub account or organisation named `wa-stay`,
not to a repository: it would need an organisation called `wa-stay` holding a repository called
`wa-stay.github.io`. With a custom domain the `github.io` address no longer matters, so the
project site above is the simplest start.

## Turning it on

Once, in the repository on GitHub:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Actions → Website → Run workflow** (or merge a change to `site/`). The run's summary links
   to the published page.
3. **The repository's About panel** (the gear beside "About" on the repository's front page):
   set **Website** to the page's address, so people find it from GitHub.

The download buttons link to the [latest release](https://github.com/wilsonwaters/wa-stay/releases/latest).
When that release has a `WA-Stay-Setup-x.y.z.exe`, `site/site.js` points them straight at the
installer and shows its version. Until 2.0.0 is published, the latest release is 1.2.0, so the
buttons stay on the release page. Publish 2.0.0 before announcing the site.

## A custom domain

For example `wastay.com.au` (a `.com.au` name needs an ABN or ACN; `wastay.au` is the same
idea without the `.com`):

1. **Verify the domain** for your GitHub account first (**Settings → Pages → Add a domain**, in
   your account settings rather than the repository's). This stops anyone else's repository
   from claiming it.
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

The screenshots in `site/assets/screens/` come from the built app, with the Mapbox map, in
network-free fixture mode. `npm run site:screenshots` rebuilds and retakes them. Retake them when
a screen they show changes.

They never show a provider's photos or documents: DBCA's campground photos and maps appear live
in the app and are never copied into the repository or the site.

## Rules for the page

- **The app's design language applies** ([design language](design/design-language.md)): the
  palette (the colours are copied from `tokens.css`, and the test keeps them equal), Fraunces
  only at display sizes, coral only for the one main button in a view, at most one brushstroke
  in a region, and no gradients, glass or emoji.
- **Say only what is true**, in the app's voice: Australian English and sentence case, with
  "checks as often as every 15 minutes" rather than "never miss a site". A feature still marked
  "Soon" in the app is described as coming, never as available.
- **Name ParkStay WA only as the provider**, and keep the independence notice: WA Stay is not
  made by or affiliated with DBCA, and it is not a government service.
- **Nothing from another site.** Fonts, images and the script are files in `site/`, and the
  page sets no cookies and has no analytics. The only outside request is the script's call to
  GitHub for the latest release, which the page's Content-Security-Policy allows and nothing
  else.
