# B1 — Brand assets: original logo, icon set, installer art, banner

**Stream:** brand-migration · **Depends on:** D1

## Description

WA Stay needs its own mark. Today the app ships an orange tent icon (`resources/icon-source.png`, 1600²) and an illustrated banner (`resources/banner.png`, plus a 5.7 MB `banner-source.png`). Neither matches the new design language.

The stakeholder's mood reference is the WA Tourism Commission logo: a black swan over a blue brushstroke, with a gold sun and a coral beak. It is trademarked. We take **only its palette and brushstroke mood** (architecture-notes §9, brief O4) and design an original mark.

This task produces:

- the vector source of truth;
- a reproducible script that generates every raster the build needs;
- a renderer copy for the app shell.

As a person installing WA Stay, I see a coherent, distinctive WA Stay mark on the installer, desktop shortcut, taskbar, notifications, window and README.

## Size

M

## Scope

**In scope**

1. **SVG source in `resources/brand/`**, all on an integer `viewBox`, colours taken from the D1 palette:
   - `wa-stay-mark.svg`: square mark, full colour.
   - `wa-stay-mark-small.svg`: simplified for 16–32 px. No thin strokes, at most 3 shapes.
   - `wa-stay-lockup.svg`: horizontal mark + "WA Stay" wordmark. Set the wordmark in Fraunces (D1 display face) and **convert it to outlines**, so there is no `<text>`.
   - `wa-stay-mark-mono.svg` and `wa-stay-lockup-mono.svg`: single colour, `fill="currentColor"`.
   - `readme-banner.svg`: 1280×640. It doubles as the GitHub social preview.
2. **Concept.**
   - Primary: a sun-gold half-disc setting into an Indian Ocean blue hand-drawn brushstroke (WA is where the sun sets over the ocean), under an ink roofline chevron that suggests "a place to stay" and a stylised "A".
   - Coral is used at most once, as a small accent.
   - Reuse or derive the brushstroke geometry from D1's atoms (`src/renderer/assets/brush/`). Draw it as geometry, not SVG filters.
   - Produce one alternative concept for BQ1.
3. **Generator.** Rewrite `scripts/generate-icons.js` and add `scripts/lib/bmp.js`. sharp 0.34.5 (librsvg 2.61) rasterises the SVGs. png-to-ico 3.0.1 is already a devDependency. Add `"icons": "node scripts/generate-icons.js"` to `package.json`. The script writes:
   - `resources/icons/icon.ico`: 16, 24, 32, 48, 64, 128, 256. Sizes ≤32 come from `wa-stay-mark-small.svg`.
   - `resources/icons/icon.png` (1024²) and the Linux set `{16,32,48,64,128,256,512,1024}x{same}.png`. `linux.icon` is the folder (`electron-builder.json:137`).
   - `resources/icons/installer-header.bmp` (150×57) and `installer-sidebar.bmp` (164×314). These are **24-bit uncompressed BMP**, written by `bmp.js` from `sharp(...).raw()`, because sharp cannot write BMP.
   - `resources/brand/readme-banner.png` (1280×640).
   - `src/renderer/assets/brand/{logo-mark.svg, logo-lockup.svg, logo-mark-mono.svg}`. These are byte copies, and D3 expects `logo-lockup.svg` at exactly this path.
   - `docs/design/brand/contact-sheet.png`: icon at 16/24/32/48/256 on sand and on ink, both installer images, the lockup, and the alternative concept.
4. **Resolve PNG-versus-BMP for installer art.**
   - Today `electron-builder.json:101-103` points at `.png`, and `resources/README.md:20-21,143-160` says `.bmp`.
   - electron-builder passes the path straight to `MUI_HEADERIMAGE_BITMAP` / `MUI_WELCOMEFINISHPAGE_BITMAP` (`node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js:396-406`). NSIS loads these as bitmaps only, so the PNGs most likely render blank.
   - Switch all three keys (`installerHeader`, `installerSidebar`, `uninstallerSidebar`) to the `.bmp` files and delete the `.png` versions.
5. **macOS.**
   - Do not generate `.icns`. Point `mac.icon` (`:34`) at `resources/icons/icon.png`; electron-builder converts it from 512 px or larger.
   - Remove `dmg.icon` (`:63`) so it falls back to the app icon.
6. **Renderer `Logo`.**
   - Create `src/renderer/components/ui/Logo.tsx` with props `variant: 'mark' | 'lockup'` and optional `decorative`.
   - It renders `<img>` from the Vite asset URL with `alt="WA Stay"`, or `alt=""` with `aria-hidden` when decorative. Size it with tokens, not raw hex.
   - Do not edit D2's `components/ui/index.ts` barrel. D3 imports the file directly.
   - Add a Jest `moduleNameMapper` stub for `\.(svg|png)$` if one is missing.
7. **CI and repo.**
   - Extend the "Verify icon assets exist" step (`.github/workflows/build.yml:91-97`). Today it checks only `icon.ico`. Make it check `icon.ico`, `icon.png`, `256x256.png`, `installer-header.bmp` and `installer-sidebar.bmp`.
   - Generated files stay **committed**. CI never regenerates them, because librsvg anti-aliasing differs between OSes.
   - Delete `resources/icon-source.png`, `resources/banner-source.png` and `resources/banner.png`.
   - Update the two header images in `README.md:1-8` so the README is not broken before Q2 rewrites it.
8. **Rewrite `resources/README.md`.** Cover: the pipeline, `npm run icons`, sizes and formats, logo usage (clear space = the height of the chevron, minimum 16 px mark and 96 px lockup, do/don't), the palette, and a licence note. The art is original. Fraunces is SIL OFL 1.1 (`node_modules/@fontsource-variable/fraunces/LICENSE`), and outlining it in a logo is permitted. Add the statement "Not affiliated with Tourism WA or DBCA".

**Out of scope**

- App or product renaming, the BrowserWindow icon and the notification icon path (B2).
- Shell layout (D3) and the About dialog (U5).

## Non-goals

- No new dependencies: no icns encoder, no svgr, no opentype. Outlining the wordmark is a one-off design step, and the committed SVG holds paths.
- No swan, bird or animal silhouette, and no ink figure placed above a blue stroke with a gold disc in the reference's arrangement.
- No logo image in emails (B2 uses a text wordmark), no animated logo, no dark-theme variants (brief).

## Completion Criteria

- [ ] `resources/brand/` contains the 6 SVGs from Scope 1 plus `README.md`. Each SVG opens in a browser.
- [ ] Brand SVGs contain no `<text>`, `<image>`, `<filter>`, `<foreignObject>`, external `href`, or embedded `data:` raster (test).
- [ ] Every `fill`/`stroke` hex in the colour SVGs matches a palette value in D1's token source `src/renderer/styles/tokens.css`. That file stores `--ws-<name>: R G B;` triples, so the test converts the hex to RGB before comparing. Mono SVGs use only `currentColor` or `none` (test).
- [ ] `npm run icons` exits 0 with no network access. A second run leaves `git status` clean (byte-identical on the same machine).
- [ ] `resources/icons/icon.ico` has exactly 7 entries: 16, 24, 32, 48, 64, 128, 256 (test parses the ICO directory).
- [ ] `icon.png` is 1024×1024, and every `NxN.png` has its stated dimensions (test via `sharp().metadata()`).
- [ ] `installer-header.bmp` is 150×57 and `installer-sidebar.bmp` is 164×314, both with a `BM` signature, 24 bpp and `BI_RGB` (test parses the header).
- [ ] `electron-builder.json`: the three NSIS image keys end in `.bmp`, `mac.icon` is `resources/icons/icon.png`, and `dmg.icon` is absent. No `.png` installer images remain.
- [ ] `src/renderer/assets/brand/logo-lockup.svg`, `logo-mark.svg` and `logo-mark-mono.svg` are byte-identical to their `resources/brand` sources (test).
- [ ] `docs/design/brand/contact-sheet.png` exists. The 16 px icon is recognisable on both sand and ink (reviewer).
- [ ] Old rasters are deleted. `README.md` header images resolve to `resources/brand/readme-banner.png` and the mark.
- [ ] The CI asset-check step lists all 5 files. The PR's `Build Windows` job is green.
- [ ] Accessibility:
  - [ ] `Logo` exposes `role="img"` with the accessible name "WA Stay" by default.
  - [ ] With `decorative`, it is hidden from the accessibility tree.
  - [ ] Lockup ink on sand and the mono variant on ocean blue meet 3:1 non-text contrast. Values are recorded in `resources/brand/README.md`.
- [ ] `npm run lint` (0 errors), `npm run format:check`, `npm run type-check` and `npm test` all pass.

## Edge Cases

- At 16 px the brushstroke texture turns to mush. The small variant must keep a clear silhouette: the disc and chevron are readable on a dark Windows taskbar.
- Transparent corners in the ICO. Windows draws on any background, so check the dark-taskbar case on the contact sheet.
- BMP rows are bottom-up and BGR, padded to 4 bytes. 150 px × 3 = 450 → pad to 452. Alpha must be flattened onto an opaque background: sand for the sidebar, white for the header.
- The NSIS sidebar is tall and narrow (164×314). Compose it as its own artboard, not a crop of the banner. The current script crops `fit: 'cover'` (`generate-icons.js:58-70`).
- Missing source SVG or invalid XML: the script exits non-zero with the file name. Replace today's emoji console output with plain text.
- A Windows path with spaces: build every path with `path.join`.
- D1 tokens may change after B1. The palette test fails loudly, and re-running `npm run icons` fixes the assets.

## Test Strategy

- **Unit (node environment, ~10):** in `tests/unit/brand/`:
  - `bmp.js` header fields, row padding and BGR order on a 3×2 fixture;
  - SVG hygiene (forbidden elements);
  - palette subset;
  - ICO directory entries;
  - PNG and BMP dimensions;
  - renderer copies byte-identical.
  - Use `@jest-environment node` (sharp under jsdom is unreliable until P1 splits projects).
- **Component (~2):** `Logo` renders an img named "WA Stay"; with `decorative` it has no accessible name. Query by role, never by class.
- **Integration:** none. The CI `Build Windows` job packages the art. A human views the contact sheet.

## Context Files to Read First

- `ai-state/architecture-notes.md` §8–§10. `ai-state/brief.md` O4 and scope 7.
- `docs/design/design-language.md` and `src/renderer/styles/tokens.css` (D1): palette, brushstroke rules, `src/renderer/assets/brush/` atoms. If they are absent, stop and ask, because D1 is a hard dependency. Also read `ai-state/streams/design-system/tasks/D1-design-language-and-tokens.md` (proposed palette: ocean-500 `#1C8CC8` is the brushstroke; sun-400 and coral-400 are decorative only).
- `ai-state/streams/design-system/master-plan.md` (the B1 → D3 logo path contract).
- `scripts/generate-icons.js`, `resources/README.md`, `electron-builder.json:22-121`, `.github/workflows/build.yml:91-97`, `README.md:1-8`.
- `node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js:390-410`.
- `jest.config.js` (moduleNameMapper).

## Notes

- **The planning brief's ".gitignore ignores generate-icons.js" is not true.** The script and `resources/icons/*` are tracked (`git ls-files`). `git check-ignore` reports nothing, and `.gitignore` has no `*.bmp` rule.
- `notification.service.ts:241` already references `resources/icons/icon.png`, which does not exist today. B1 creates it, and B2 fixes the packaged path.
- Ask the stakeholder to upload `readme-banner.png` as the repo social preview. Q2 lists this as a stakeholder action.
- Design review gate: post the contact sheet in the PR before you polish. BQ1 is resolved in review.
