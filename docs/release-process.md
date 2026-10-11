# Release process

WA Stay ships for Windows only: an NSIS installer and a portable exe, published as a GitHub
release of [`wilsonwaters/wa-stay`](https://github.com/wilsonwaters/wa-stay). The `/release`
command (`.claude/commands/release.md`) follows this page.

## Contents

- [Quick reference](#quick-reference)
- [Step by step](#step-by-step)
- [The 2.0.0 release](#the-200-release)
- [Repository description and topics](#repository-description-and-topics)
- [The pipeline](#the-pipeline)
- [Artifacts and auto-update](#artifacts-and-auto-update)
- [Hotfixes and rollback](#hotfixes-and-rollback)

## Quick reference

```bash
git checkout main && git pull origin main
npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz

npm version minor --no-git-tag-version   # or patch / major (major for 2.0.0): package.json and the lockfile only
# CHANGELOG.md: rename [Unreleased] to [x.y.z] - YYYY-MM-DD (see step 3)
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: prepare release vx.y.z"
git tag vx.y.z
git push origin main --tags
```

Pushing the tag builds the release and creates a **draft** on GitHub; publishing the draft is a
person's decision.

## Step by step

### 1. Check the branch

Release from an up-to-date `main` with a clean working tree: the tag decides which commit
GitHub Actions builds.

```bash
git checkout main
git pull origin main
git status   # clean
```

### 2. Run the checks

```bash
npm run lint
npm run format:check
npm run type-check
npm test
npm run test:tz
npm run build
```

Optionally build the installer locally (`npm run dist:win`, into `release/`) and run the
Electron smoke tests ([development](development.md#electron-smoke-tests)). CI runs both, and the
packaged smoke check, on every push to `main`.

### 3. Update CHANGELOG.md

The changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Changes are
written under `## [Unreleased]` as they merge. To release, **rename that heading** to the new
version and date, `## [2.0.0] - 2026-11-03`, and add a fresh empty `## [Unreleased]` above it
if you like. **Do not regenerate the section from the git log**: it is written for users and
already says what they need to know (upgrade notes included). Add an entry only for something
it misses. Older versions' entries never change.

### 4. Bump the version and tag

```bash
npm version major --no-git-tag-version   # major for 2.0.0 (from 1.2.0); patch or minor later
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: prepare release v2.0.0"
git tag v2.0.0
git push origin main --tags
```

Do not use `npm run version:patch|minor|major` for a release: they push the tag before the
changelog commit. For a pre-release, `npm version preminor --preid=beta` gives `2.1.0-beta.0`
(from 2.0.0); a tag containing `alpha` or `beta` becomes a GitHub pre-release. The tag builds a
**draft** release, which no installed copy sees until it is published.

### 5. Publish

1. Wait for the **WA Stay Build and Release** workflow to finish.
2. Open [Releases](https://github.com/wilsonwaters/wa-stay/releases), find the draft, and
   replace the generated notes with the changelog section for this version.
3. **Publish release.** From then on `latest.yml` offers the update to every installed copy.

### 6. Check the release

- Download the installer from the release page and install it on a clean Windows machine.
- Update a previous version through the app and check that its data is still there.
- SmartScreen warns for unsigned builds ([code signing](code-signing.md)).

## The 2.0.0 release

The first WA Stay release renames the app and the repository. Do these, in this order (the
[2.0 release checklist](release-checklist-2.0.md) has each step with the manual checks):

- [ ] **Rename the repository to `wa-stay` before publishing 2.0.0** (GitHub → Settings →
  General → Repository name). Installed v1.x copies look for updates at the old name and
  reach `wa-stay` only through GitHub's rename redirect. `electron-builder.json` already
  publishes to `wilsonwaters/wa-stay`.
- [ ] **Never create a new repository called `parkstay-bookings`** under the same owner: it
  would replace the redirect, and every v1.x install would stop finding updates.
- [ ] **Check the redirect** once renamed. Both must end at a `wa-stay` URL (the second is the
  feed v1.x's updater reads):

  ```bash
  curl -sIL https://github.com/wilsonwaters/parkstay-bookings/releases/latest | grep -i '^location'
  curl -sIL https://github.com/wilsonwaters/parkstay-bookings/releases.atom | grep -i '^location'
  ```

- [ ] Set the **repository description, topics and social preview** ([below](#repository-description-and-topics)).
- [ ] **Add the Mapbox token** as a repository secret named `MAPBOX_ACCESS_TOKEN` (Settings →
  Secrets and variables → Actions). The build reads
  `${{ secrets.MAPBOX_ACCESS_TOKEN || vars.MAPBOX_ACCESS_TOKEN }}`; a public `pk.` token only.
  Without it the release builds, but Explore has no map.
- [ ] Check that the `CI` workflow is green on the release commit (the tag's pipeline does not
  run the e2e or packaged smoke checks).
- [ ] Rename `## [Unreleased]` in CHANGELOG.md to `## [2.0.0] - <date>`, bump with
  `npm version major` (1.2.0 → 2.0.0), tag `v2.0.0` and push (steps 3 and 4). This builds the
  draft release.
- [ ] Work through the [2.0 release checklist](release-checklist-2.0.md)'s Windows checks on
  the draft's installer. If one fails, delete the draft and the tag, fix, and tag again.
- [ ] **Publish** the draft (step 5).
- [ ] **After publishing**, on a Windows machine with **v1.2.0 installed** and some watches,
  bookings and settings: let it update, and check that WA Stay starts with the welcome notice
  and everything is there, and that `%APPDATA%\parkstay-bookings` is untouched. If the update
  goes wrong, edit the release back to a draft at once.

## Repository description and topics

For GitHub → the repository's About settings:

- **Description:** WA Stay — find and book places to stay across Western Australia. Map-first
  discovery, availability watches and instant site holds across providers, starting with
  ParkStay WA. Electron desktop app.
- **Website:** `https://github.com/wilsonwaters/wa-stay/releases/latest`
- **Topics:** `western-australia`, `camping`, `accommodation`, `booking`, `parkstay`,
  `electron`, `react`, `typescript`
- **Social preview** (Settings → General → Social preview): `resources/brand/readme-banner.png`.

## The pipeline

**WA Stay Build and Release** (`.github/workflows/build.yml`) runs on pushes to `main` and
`develop`, pull requests, `v*` tags and by hand:

```text
ci (ubuntu, windows): type-check, lint, test:coverage, test:tz
  -> build-windows: npm run build (with MAPBOX_ACCESS_TOKEN), icon check,
                    electron-builder --win --publish never (signed when CSC_LINK is set),
                    checks WA Stay.exe's fuses, asar integrity record and better-sqlite3
                    binary (scripts/check-windows-package.js),
                    uploads the .exe files, the installer's .blockmap and latest.yml
    -> release (tags only): a draft GitHub release with the artifacts
```

**WA Stay CI** (`.github/workflows/ci.yml`) runs on pushes and pull requests: lint and
`format:check`; type-check; Jest with coverage on Ubuntu, Windows and macOS plus `test:tz`; an
npm audit; a build check; the Electron smoke tests (`e2e`, report always uploaded); and the
packaged smoke check (`packaged-smoke`). Neither the `e2e` nor the `packaged-smoke` job blocks
a release tag; consider making `e2e` a required check once it has run green for a while.

## Artifacts and auto-update

| File | What it is |
| --- | --- |
| `WA-Stay-Setup-x.y.z.exe` | The NSIS installer (recommended; updates itself) |
| `WA-Stay-Setup-x.y.z.exe.blockmap` | The installer's block map, for differential updates |
| `WA-Stay-Portable-x.y.z.exe` | The portable exe (does not update itself) |
| `latest.yml` | Update metadata for electron-updater |

The installed app checks GitHub Releases 15 seconds after it starts (`electron-updater`,
`publish` in `electron-builder.json`). It never downloads by itself: an update card offers
**Download**, then **Restart now**; a downloaded update also installs on quit. The `appId`
stays `com.parkstay.bookings`, so every release upgrades the existing install in place.

**Differential updates.** The NSIS installer is built with `differentialPackage`, so
electron-builder writes a block map beside it (`WA-Stay-Setup-x.y.z.exe.blockmap`: a
compressed list of the installer's blocks and their hashes). `latest.yml` names only the
installer (its `url`, `sha512` and `size`); electron-updater finds the block maps by convention,
the installer's URL plus `.blockmap`: the new one from the new release, and the installed
version's from its own release (the same URL with the old version number in place of the new),
unless it kept a copy from the previous update.
With both, it downloads only the blocks that changed, and falls back to the whole installer
when either block map is missing. So:

- **Every release must carry its `.blockmap`**, now and later: `build.yml` uploads
  `release/*.blockmap` with the installers, and the draft release attaches it. A release
  without one makes the next update from it download in full.
- **The first update from 1.2.0 downloads in full**: 1.2.0's release has no block map. Updates
  between 2.x releases that both carry one download only what changed.

## Hotfixes and rollback

- **Hotfix:** fix on a branch with a regression test, merge to `main`, then release a patch
  version as above.
- **Rollback:** mark the broken release as a pre-release on GitHub (it stops being offered),
  then release a fix with a **higher** version number; auto-update never goes backwards.
