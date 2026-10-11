# D1 — Design language, tokens, fonts and icons

**Stream:** design-system · **Depends on:** none

## Description

WA Stay needs one visual and verbal language before any screen is rebuilt. Today the only token is a sky-blue `primary`. The renderer mixes emoji icons, gradients, five date formats and grey text that fails AA (ui-review #2, #3, #7). This task writes the design language, encodes it as semantic CSS-variable tokens consumed by Tailwind, bundles the decided fonts (Figtree for UI, Fraunces for display, per architecture-notes §9), standardises lucide icons at stroke 1.75, and adds a dev-only `/__design` route that renders the tokens live. Every later renderer task builds on this.

As a WA Stay user, I see a calm, readable interface with a clear WA character, so the app feels trustworthy and pleasant to plan a trip in.

## Size

M

## Scope

**In scope:**
- `docs/design/design-language.md` with these sections: Principles (5 or fewer), WA rationale, Palette, Contrast pairs, Type, Spacing and layout, Radii, Elevation, Motion, Iconography, Imagery and placeholder, Brushstroke motif, Voice and tone, and a Do/Don't list.
- `src/renderer/styles/tokens.css`: `:root` variables in the form `--ws-<name>: R G B;`, both the raw palette and the semantic aliases.
- `src/renderer/styles/contrast.ts`: the pure `contrastRatio(hexA, hexB)` and `CONTRAST_PAIRS` (fg token, bg token, minimum ratio, usage).
- `tailwind.config.js` rewritten. Semantic colours map to `rgb(var(--ws-x) / <alpha-value>)`, and `fontFamily`, `fontSize`, `borderRadius`, `boxShadow`, `transitionDuration`, `transitionTimingFunction`, `zIndex` and `keyframes` (`shimmer`, `fade-in`, `scale-in`) come from tokens. The sky-blue `primary` is removed from the semantic theme. A clearly commented **legacy** block re-declares `primary-50…900` as an alias of the ocean scale, so the 73 legacy usages still render.
- `src/renderer/styles/index.css` rewritten:
  - Base: body `bg-canvas text-fg font-sans antialiased`, a global `:focus-visible` ring, `::selection`, and a `prefers-reduced-motion` reset.
  - A **legacy bridge**: `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.input` and `.card` restyled with tokens and marked `/* legacy: delete when U-stream lands */`.
- Fonts: `import '@fontsource-variable/figtree'` and `import '@fontsource-variable/fraunces/opsz.css'` in `src/renderer/main.tsx`. The packages are already installed by `chore(deps)`; do not re-add them.
- `<LucideProvider strokeWidth={1.75} size={20}>` wrapping the app in `main.tsx`. D3 moves it to `app/AppProviders.tsx`.
- Visual atoms in `src/renderer/components/ui/`:
  - `Brushstroke.tsx`: variants `underline`, `dab`, `swash`, using original SVGs in `src/renderer/assets/brush/`, decorative, `aria-hidden`.
  - `PhotoPlaceholder.tsx`: the no-photo treatment, `role="img"` with an `aria-label` prop.
- A dev-only route at `#/__design` (`src/renderer/features/design-preview/DesignPreviewPage.tsx`), lazy-loaded and registered only when `import.meta.env.DEV`. It is registered **outside** the current login gate in `App.tsx`. D3 later moves it into the route table. It shows swatches (token, hex, live contrast against `surface` and `canvas`), the `CONTRAST_PAIRS` table with pass/fail, type specimens, spacing, radii, elevation, a motion demo, the icon set and the brushstroke/placeholder usages.
- Guard tests: the contrast test and the token guard (see Test Strategy).

**Out of scope:** UI components beyond the two atoms (D2), shell and nav (D3), the logo (B1), and restyling legacy pages beyond the bridge classes.

## Non-goals

- No dark theme, no `dark:` classes (brief).
- No Storybook or new dependencies. lucide-react, `@fontsource-variable/figtree` and `@fontsource-variable/fraunces` are already present (architecture-notes §10).
- The type choice is not reopened. Figtree and Fraunces are decided, and the doc records *why* (see Notes).
- Tailwind's default colour palette stays in place until the U-stream finishes. The guard stops new code from using it.

## Completion Criteria

- [ ] `docs/design/design-language.md` exists with every section listed in Scope. Each section has at least one concrete rule (a value, a usage or a ban), not just prose.
- [ ] The palette in the doc lists exact hex values for ocean, coral, sun, eucalypt, sand, ink and danger, and the semantic aliases: `canvas`, `surface`, `surface-subtle`, `surface-inverse`, `fg`, `fg-muted`, `fg-inverse`, `border`, `border-strong`, `brand`, `brand-strong`, `brand-subtle`, `accent`, `accent-hover`, `accent-subtle`, `accent-fg`, `focus`, `available`, `available-subtle`, `available-fg`, `warning-subtle`, `warning-fg`, `danger`, `danger-subtle`, `danger-fg`, `sun`.
- [ ] The doc's contrast table matches `CONTRAST_PAIRS` one-to-one. Each pair has a computed ratio, and text pairs are 4.5:1 or more while UI and large-text pairs are 3:1 or more.
- [ ] `tailwind.config.js` exposes those semantic names, and classes such as `bg-accent text-accent-fg`, `text-fg-muted`, `border-border-strong` and `ring-focus` compile.
- [ ] `primary-*` exists only inside the commented legacy block.
- [ ] Opening the legacy Watches page shows the new fonts and the tokenised `.btn-primary`/`.input`/`.card`, with no unstyled controls.
- [ ] The Figtree and Fraunces woff2 files are emitted into `dist/renderer/assets/` by `npm run build:renderer`. Nothing is loaded from a CDN, and the network tab shows no font requests to external hosts.
- [ ] `#/__design` renders in `npm run dev` and is absent from the production bundle: `grep -r "DesignPreview" dist/renderer` finds nothing.
- [ ] `Brushstroke` renders the three original SVG variants. `PhotoPlaceholder` renders the kind icon plus "No photo yet" and accepts an `aria-label`.
- [ ] Icons render at stroke 1.75 by default, set by `LucideProvider` in `main.tsx`. The doc's icon table names the lucide component for each kind, amenity and state.
- [ ] **Accessibility:**
  - [ ] Every `CONTRAST_PAIRS` entry passes in `tests/unit/design/contrast.test.ts`, which reads hex values from `tokens.css`, so the test fails if a token drifts.
  - [ ] The global `:focus-visible` ring uses `focus` (ocean-600). It is at least 3:1 against both `surface` and `canvas`, and visible on `/__design` buttons when tabbing.
  - [ ] With `prefers-reduced-motion: reduce` emulated, the `/__design` motion demo and skeleton shimmer do not animate.
  - [ ] Muted text (`fg-muted`) is at least 4.5:1 on `surface`, `canvas` and `surface-subtle`, which replaces the failing gray-400 (ui-review #7).
- [ ] The 4-check gate passes: `npm run lint` (0 errors), `npm run format:check`, `npm run type-check`, `npm test`.

## Edge Cases

- **Legacy classes:** 723 raw palette usages in `pages/` and `components/` must keep compiling. Do not remove the Tailwind defaults.
- **`<alpha-value>`:** `bg-accent/10` must work, so variables hold space-separated RGB channels, not hex.
- **Fonts:** Fraunces renders only where `font-display` is applied. The body never falls back to Times. The fallback stack is `"Figtree Variable", system-ui, "Segoe UI", sans-serif`, plus `"Fraunces Variable", Georgia, serif` for display.
- **lucide-react 1.x renames:** use `House` (not `Home`), `LoaderCircle` (not `Loader2`), and import `Map as MapIcon` to avoid shadowing the global `Map`.
- **Contrast parser:** `contrast.test.ts` must fail clearly when a token named in `CONTRAST_PAIRS` is missing from `tokens.css`.
- **Token guard false positives:** class names inside comments and `tokens.css` itself are excluded. ProviderBadge colours come from data, not literals.
- **Electron zoom:** at 80% to 150% browser zoom, `/__design` has no clipped specimens.

## Test Strategy

- **Unit:** about 8 tests.
  - `contrastRatio` against known pairs (`#000`/`#fff` gives 21, same colour gives 1, and the shorthand `#fff` parses).
  - Every `CONTRAST_PAIRS` entry meets its minimum, reading `tokens.css`.
  - A missing token fails with a named error.
  - `tests/unit/design/token-guard.test.ts` scans `src/renderer/{components/ui,app,features,api}/**/*.{ts,tsx}`, excluding `**/legacy/**`. It fails on the regex `(bg|text|border|ring|fill|stroke|from|via|to|outline|divide|placeholder|shadow)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|primary)-\d{2,3}`, on hex literals and on `\p{Extended_Pictographic}`. It also has a self-test that runs on a fixture string.
- **Component:** about 4 tests.
  - `Brushstroke` is `aria-hidden` and has no accessible name.
  - `PhotoPlaceholder` exposes `role="img"` with the given name.
  - `DesignPreviewPage` renders a heading per section and one contrast row per pair, using role queries only and never class names.
- **Integration:** none. Run runtime verification on `#/__design`: screenshot it, run axe (0 critical/serious), and run a keyboard focus pass.

## Context Files to Read First

- `ai-state/architecture-notes.md`: §8 renderer conventions, §9 design direction, §10 dependencies.
- `ai-state/brief.md`: scope item 7, success criterion 10, O4 (original logo).
- `ai-state/research/ui-review.md`: styling, the top UX problems, branding.
- `tailwind.config.js`, `postcss.config.js`, `src/renderer/styles/index.css`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `vite.config.ts`.
- `node_modules/@fontsource-variable/fraunces/opsz.css`, `node_modules/lucide-react/dist/lucide-react.d.ts` (`LucideProvider`).
- The orchestration methodology (`projects/project-orchestration/ai-development-methodology.md` in the sandbox repository): Task Structure, Accessibility in Specs.

## Notes

**Proposed starting palette.** It was verified with WCAG 2.x relative luminance on 2026-10-02. The implementer may tune it but must keep every pair passing.

| Token | Hex | Role |
|---|---|---|
| ink-900 / ink-700 | `#15181D` / `#3A3F47` | `fg` text / secondary text (black swan) |
| sand-0, 50, 100, 200, 500, 600 | `#FFFFFF`, `#FAF7F2`, `#F3EEE6`, `#E6DED2`, `#8A7F70`, `#6B6256` | surface, canvas, subtle fill, hairline, `border-strong`, `fg-muted` |
| ocean-50, 100, 500, 600, 700 | `#EAF5FB`, `#CFE8F5`, `#1C8CC8`, `#0F72A6`, `#0B5C87` | brand-subtle, map water, brushstroke, focus, brand-strong and links |
| coral-50, 400, 600, 700 | `#FDEEEA`, `#F2795C`, `#C4432A`, `#A33722` | accent-subtle, decorative, **CTA**, CTA hover and coral text |
| sun-50, 100, 400, 700 | `#FEF7E1`, `#FCEBB6`, `#F2B91F`, `#855A00` | warning-subtle, Soon pill, decorative sun, warning-fg |
| eucalypt-50, 600, 700 | `#EAF4EE`, `#2A7350`, `#215C40` | available-subtle, available fill, available-fg |
| danger-50, 600, 700 | `#FDECEC`, `#B42318`, `#912018` | danger-subtle, danger, danger-fg |

Verified ratios:

| Pair | Ratio |
|---|---|
| ink-900 on canvas | 16.65 |
| fg-muted on surface / canvas / subtle | 5.99 / 5.60 / 5.19 |
| white on coral-600 | 5.02 |
| coral-700 on white | 6.72 |
| ocean-600 on white (focus and link) | 5.28 |
| ocean-600 on canvas | 4.94 |
| ocean-700 on ocean-50 | 6.55 |
| sun-700 on sun-100 | 5.12 |
| eucalypt-700 on eucalypt-50 | 6.99 |
| white on eucalypt-600 | 5.73 |
| danger-700 on danger-50 | 7.59 |
| white on danger-600 | 6.57 |
| sand-500 on surface (input border, UI) | 3.92 |
| ocean-500 on surface (active brushstroke, UI) | 3.73 |

**sand-300 (`#D3C8B8`) is only 1.65:1 and must not be used for input borders.** Coral-400 and sun-400 are decorative only and never carry text.

**Role decisions** (stakeholder sign-off pending, DQ2):
- Coral is the single CTA colour: Search, Book, Create, Save. Use one per view.
- Ocean is the brand colour: logo, brushstroke, links, focus, selected states and map water.
- Ink is for text, outline secondary buttons and hovered or selected map pills.
- Sun is for time and release cues and the "Soon" pill.
- Eucalypt means available or success.
- Danger is red. Show it as text or outline, and as a solid fill only for the ConfirmDialog confirm, which replaces the coral CTA there.

**Type rationale.** The doc must record this:
- Figtree is a friendly geometric sans and the closest free analogue to Airbnb Cereal. It is legible at 12–14px in dense lists and small (about 20 KB per subset).
- Fraunces is a "wonky" old-style serif. Its optical sizing gives warmth at display sizes. Use it only for location names, EmptyState titles and the wordmark, never for body text, buttons or cards. Use the `opsz.css` build (opsz and wght axes, about 67 KB).

**Type scale** (size/line-height in px): xs 12/16, sm 14/20, base 16/24, lg 18/28, xl 20/28, 2xl 24/32. Display sizes (Fraunces): display-sm 28/34, display-md 36/42, display-lg 48/52.

**Other tokens:**
- Radii: sm 6, md 8, lg 12, xl 16, 2xl 24, full.
- Elevation: shadows tinted with ink at low alpha — `card`, `pill`, `pop`, `modal`. No glows.
- Motion: 120, 200 and 320 ms, with easing `cubic-bezier(.2,0,0,1)`. Durations drop to 0 under reduced motion.
- z-index: header 30, tray 40, overlay 50, toast 60, tooltip 70.

**`/__design` versus Storybook.** The route renders with the real fonts, tokens, CSP and Electron Chromium, costs no new dependencies, is tree-shaken from production, and gives runtime verification (axe and screenshots) one stable URL. D2 extends it with a component gallery.

**Brushstroke rules:**
- Draw it as an original hand-drawn path. Never trace it from the WA Tourism mark (O4).
- Only colour it ocean-500, ocean-100, sun-400 or sun-100.
- Allowed places: the active nav underline, the logo, the placeholder dab and the EmptyState accent.
- Never use it behind body text or as a button fill, and show at most one per region.

**Voice and tone:**
- Australian English, sentence case, verbs on buttons.
- Dates as "Fri 3 Oct 2026", ranges as "3–5 Oct".
- No exclamation marks, no "Oops", no claims the app can't guarantee (ui-review #9).
