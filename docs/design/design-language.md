# WA Stay design language

WA Stay should feel like a calm, well-made travel app that could only come from Western Australia. Its structure follows Airbnb: photo first, generous space, one search pill, and a map beside a list. The WA character comes from a small, deliberate palette and one hand-drawn brushstroke, never from decoration piled on top.

This document is the rulebook. Everything in it is encoded and checked:

| Where | What |
| --- | --- |
| `src/renderer/styles/tokens.css` | The token values, as `--ws-*` CSS variables. **The single source of truth.** |
| `src/renderer/styles/index.css` | The Tailwind 4 configuration, CSS-first: its `@theme` block maps utility names (`bg-accent`, `text-fg-muted`, `rounded-lg`, `shadow-pop`, `z-tray`) onto those variables. It holds no values of its own. |
| `src/renderer/styles/contrast.ts` | `contrastRatio()` and `CONTRAST_PAIRS`, the colour pairs we promise to keep accessible. |
| `tests/unit/design/contrast.test.ts` | Reads `tokens.css` and fails if any pair drops below its minimum, or a named token disappears. |
| `tests/unit/design/token-guard.test.ts` | Fails on raw Tailwind colour classes (`bg-gray-500`, `text-primary-600`, `accent-blue-600`, `bg-white`, `text-black`), hex literals, numeric colour functions (`rgb(0 0 0)`, `hsl(…)`; `rgb(var(--ws-…))` is fine) and emoji in `components/ui`, `app`, `features` and `api` (legacy folders excluded). Typographic symbols such as © ® ™ ↔ → ★ are not emoji and pass. A line that genuinely needs one of these, such as `"Site #101"`, opts out with a `token-guard-ignore` comment on that line, giving the reason. |
| `tests/unit/design/design-language-doc.test.ts` | Keeps this document's palette, contrast and icon tables in step with the code. |
| `#/__design` | A dev-only page that renders every token, pair, specimen and atom live. Run `npm run dev` and open it. It is not in production builds. |

## Principles

1. **Calm first, WA second.** Space, photos and clear type do the work. The WA flavour is the palette plus at most one brushstroke per region. If a screen feels busy, remove decoration before anything else.
2. **One loud thing per view.** Coral is the only call-to-action colour, and a view has one coral button: Search, Book, Create or Save. Everything else is an ink outline, a ghost button or a link.
3. **Say only what is true.** Copy, status and colour never promise more than the app can do. "Checks every 5 minutes", not "never miss a site".
4. **Readable by everyone.** Every colour pair meets WCAG AA (tested), focus is always visible, colour is never the only signal, and motion is optional.
5. **The provider is always in view.** Every watch, snipe, booking, notification and location shows its `ProviderBadge`, so people always know whose system they are dealing with.

## WA rationale

The stakeholder's mood reference is the WA Tourism Commission mark: a painterly Indian Ocean blue brushstroke, a gold sun, a black swan and a coral beak. It is a trademark, so we take **only its palette and the gesture of a loaded brush**. We never use the swan, the sun-over-stroke composition or any traced shape (brief O4).

The three anchor colours are sampled from the stakeholder-supplied reference image; dominant brushstroke ≈ `#3870B0`–`#3A74B8`, sun ≈ `#E8B858`, beak ≈ `#D05830`. They become `ocean-500` (`#3A74B8`), `sun-400` (`#E8B858`) and `coral-400` (`#D05830`), and a contrast test pins them. The other ocean, sun and coral steps are derived from these anchors, tuned so every pair below passes.

| WA idea | Becomes | Why |
| --- | --- | --- |
| Indian Ocean | **Ocean**, the brand blue | Anchored on the sampled brushstroke blue (`ocean-500` `#3A74B8`, hue 212°). It is deeper and greyer than Tailwind's `sky`, which the old app used and which reads as "default web app". |
| The sun setting into the sea | **Sun** gold | Anchored on the sampled sun (`sun-400` `#E8B858`). Time and release cues: "opens at midnight", "Soon". Gold is the colour of waiting for something. |
| The black swan | **Ink**, a blue-black | Text and dark surfaces. A hint of blue ties it to the ocean, so it is never a flat grey-black. |
| The coral beak, Ningaloo, red-earth warmth | **Coral** for action | Anchored on the sampled beak (`coral-400` `#D05830`), deepened to `coral-600` for the button so white text passes AA. The warm accent stands out against blue water and green parks on the map, as Airbnb's red does on its map. |
| Coastal sand and limestone | **Sand** neutrals | Warm off-white page and fills. Cool greys read as an enterprise dashboard; sand reads as paper and coast. |
| Eucalypt woodland | **Eucalypt** green for "available" | A blue-green gum-leaf tone, not a traffic-light green. |

Rules:

- No purple, indigo or violet anywhere. No rainbow sets of button colours.
- No gradients, except the skeleton shimmer while content loads.
- No glassmorphism, frosted panels, glows, neon or drop-shadowed text.
- The swan, or any bird silhouette, never appears in WA Stay artwork.

## Palette

The raw palette. Components never use these names directly; they use the semantic aliases below. Raw values are for illustration only: the brushstroke, the map style (E1) and the logo (B1).

| Token | Hex | Role |
| --- | --- | --- |
| `ink-900` | `#15181D` | Primary text, dark surfaces |
| `ink-700` | `#3A3F47` | Secondary text |
| `sand-0` | `#FFFFFF` | Surfaces: cards, header, dialogs |
| `sand-50` | `#FAF7F2` | The page (canvas), map land |
| `sand-100` | `#F3EEE6` | Subtle fills: selected rows, chips, placeholders |
| `sand-200` | `#E6DED2` | Hairlines between things |
| `sand-500` | `#8A7F70` | Control borders (inputs, checkboxes) |
| `sand-600` | `#6B6256` | Muted text |
| `ocean-50` | `#EEF4FB` | Brand tint behind selected chips |
| `ocean-100` | `#D6E5F5` | Map water, soft brushstroke, text selection |
| `ocean-200` | `#AECBEA` | Map waterways |
| `ocean-500` | `#3A74B8` | The sampled brushstroke blue |
| `ocean-600` | `#2D60A0` | Brand, focus ring |
| `ocean-700` | `#214C82` | Links, brand text on tints |
| `coral-50` | `#FDF0EA` | Accent tint |
| `coral-400` | `#D05830` | The sampled beak. Decorative or large graphics only (4.10:1 on `surface`): the logo's coral accent. Never text, never a fill under text. |
| `coral-600` | `#BF4520` | **The call to action** |
| `coral-700` | `#9E3819` | CTA hover, and coral text in the rare case it is needed |
| `sun-50` | `#FEF7E1` | Warning tint |
| `sun-100` | `#FCEBB6` | "Soon" pill, soft sun brushstroke |
| `sun-400` | `#E8B858` | The sampled sun. Decorative only: the sun in artwork and brushstrokes. Never text. |
| `sun-700` | `#855A00` | Warning and release text |
| `eucalypt-50` | `#EAF3EE` | Available tint |
| `eucalypt-600` | `#2D7356` | Available fill and glyph |
| `eucalypt-700` | `#215742` | Available text on tints |
| `danger-50` | `#FCEDEF` | Error tint |
| `danger-600` | `#B3263E` | Error text, destructive outline |
| `danger-700` | `#8E1E31` | Error text on tints, destructive confirm fill |

Semantic aliases, which is what components use (`bg-surface`, `text-fg-muted`, `border-border-strong`, `ring-focus`):

| Alias | Points at | Hex | Use for |
| --- | --- | --- | --- |
| `canvas` | `sand-50` | `#FAF7F2` | The page background |
| `surface` | `sand-0` | `#FFFFFF` | Cards, header, menus, dialogs, inputs |
| `surface-subtle` | `sand-100` | `#F3EEE6` | Selected rows, chips, table headers, placeholders |
| `surface-inverse` | `ink-900` | `#15181D` | Tooltips, hovered and selected map pills |
| `fg` | `ink-900` | `#15181D` | Headings, body text, icons |
| `fg-secondary` | `ink-700` | `#3A3F47` | Descriptions, metadata, secondary labels |
| `fg-muted` | `sand-600` | `#6B6256` | Hints, timestamps, placeholders, booked nights |
| `fg-inverse` | `sand-0` | `#FFFFFF` | Text on ink, brand, eucalypt or danger fills |
| `border` | `sand-200` | `#E6DED2` | Hairlines between items. Never the only edge of a control. |
| `border-strong` | `sand-500` | `#8A7F70` | Input, select and checkbox borders |
| `brand` | `ocean-600` | `#2D60A0` | Selected states, checked controls, brand icons |
| `brand-strong` | `ocean-700` | `#214C82` | Links, text on `brand-subtle` |
| `brand-subtle` | `ocean-50` | `#EEF4FB` | Selected chip background, brand badge |
| `accent` | `coral-600` | `#BF4520` | The one primary button per view |
| `accent-hover` | `coral-700` | `#9E3819` | Primary button hover, coral text |
| `accent-subtle` | `coral-50` | `#FDF0EA` | Accent badge background |
| `accent-fg` | `sand-0` | `#FFFFFF` | Label on the primary button |
| `focus` | `ocean-600` | `#2D60A0` | The focus ring, everywhere |
| `available` | `eucalypt-600` | `#2D7356` | Available pills, glyphs and solid badges |
| `available-subtle` | `eucalypt-50` | `#EAF3EE` | Available badge and notice background |
| `available-fg` | `eucalypt-700` | `#215742` | Available text on `available-subtle` |
| `warning-subtle` | `sun-50` | `#FEF7E1` | Warning notice, not-yet-released nights |
| `warning-fg` | `sun-700` | `#855A00` | Warning and release text |
| `danger` | `danger-600` | `#B3263E` | Error text, destructive outline |
| `danger-subtle` | `danger-50` | `#FCEDEF` | Error notice background |
| `danger-fg` | `danger-700` | `#8E1E31` | Error text on `danger-subtle`; the destructive confirm fill, deep enough to never read as the coral primary |
| `sun` | `sun-400` | `#E8B858` | Decorative sun only |
| `sun-subtle` | `sun-100` | `#FCEBB6` | "Soon" pill, sun badge |

Rules:

- **Coral is for one thing: the primary action.** Never use it for headings, icons, links, selected states or illustration (the logo's single `coral-400` accent is the exception).
- **Danger is crimson, coral is orange-red.** They sit 24° apart in hue so a Book button never reads as a Delete button. Danger appears as text or an outline. It is a solid fill only for the confirm button of a destructive `ConfirmDialog`, which then replaces the coral button in that view.
- **Inputs use `border-strong`** (3.92:1). The hairline `border` (1.33:1) separates list items and cards, and is never the only visible edge of something you can click or type into. A `sand-300` step was deliberately left out: at 1.65:1 it looks like a border but fails as one.
- **Alpha is for overlays**, such as `bg-accent/10` for a pressed state or `bg-surface-inverse/40` for a scrim. Never fade text with opacity; use `fg-secondary` or `fg-muted`.
- **Focus is always `focus` at full strength.** The global `:focus-visible` outline and a bare `ring-2` (no colour class) both use it, and a ring offset is `surface`. Tailwind's default half-transparent blue ring is gone.
- Tokens hold space-separated RGB channels (`--ws-coral-600: 191 69 32;`), so `rgb(var(--ws-coral-600) / 0.4)` works anywhere. Tailwind's alpha modifier (`bg-accent/10`) mixes the colour with transparent.
- There is no dark theme in this project. Aliases are the seam for one later: a theme redefines the aliases and nothing else.
- **Legacy only:** `primary-50…900` still exists in a commented block of the `@theme` in `src/renderer/styles/index.css`, re-pointed at ocean so the old pages render. New code must not use it, and the token guard rejects it.

## Contrast pairs

Every colour combination the app uses, one-to-one with `CONTRAST_PAIRS` in `src/renderer/styles/contrast.ts`. Ratios are WCAG 2.x, computed from `tokens.css` (the test recomputes them on every run). Text needs 4.5:1, and UI parts (focus rings, control borders, meaningful shapes) and large text need 3:1.

| Foreground | Background | Kind | Ratio | Minimum | Usage |
| --- | --- | --- | --- | --- | --- |
| `fg` | `canvas` | text | 16.65 | 4.5 | Body text on the page |
| `fg` | `surface` | text | 17.79 | 4.5 | Body text on cards, dialogs and the header |
| `fg` | `surface-subtle` | text | 15.41 | 4.5 | Text on subtle fills (selected rows, chips) |
| `fg-secondary` | `surface` | text | 10.60 | 4.5 | Secondary text: descriptions, metadata |
| `fg-secondary` | `canvas` | text | 9.92 | 4.5 | Secondary text on the page |
| `fg-secondary` | `surface-subtle` | text | 9.17 | 4.5 | Secondary text on subtle fills, table headers |
| `fg-muted` | `surface` | text | 5.99 | 4.5 | Muted text: hints, timestamps, placeholders |
| `fg-muted` | `canvas` | text | 5.60 | 4.5 | Muted text on the page |
| `fg-muted` | `surface-subtle` | text | 5.19 | 4.5 | Muted text on subtle fills, booked nights, full and not-open map pills |
| `fg-inverse` | `surface-inverse` | text | 17.79 | 4.5 | Tooltips, hovered and selected map pills |
| `accent-fg` | `accent` | text | 5.14 | 4.5 | Primary button label |
| `accent-fg` | `accent-hover` | text | 6.92 | 4.5 | Primary button label on hover |
| `accent-hover` | `surface` | text | 6.92 | 4.5 | Coral text, the rare case it is needed |
| `accent-hover` | `accent-subtle` | text | 6.21 | 4.5 | Accent badge |
| `brand` | `surface` | text | 6.38 | 4.5 | Brand-coloured text and icons |
| `brand` | `canvas` | text | 5.97 | 4.5 | Brand-coloured text on the page |
| `brand-strong` | `surface` | text | 8.67 | 4.5 | Links |
| `brand-strong` | `canvas` | text | 8.12 | 4.5 | Links on the page |
| `brand-strong` | `brand-subtle` | text | 7.84 | 4.5 | Selected chip, brand badge |
| `fg-inverse` | `brand` | text | 6.38 | 4.5 | Text on a solid brand fill (checked control) |
| `warning-fg` | `warning-subtle` | text | 5.67 | 4.5 | Warning notice, not-yet-released nights |
| `warning-fg` | `sun-subtle` | text | 5.12 | 4.5 | "Soon" pill, sun badge |
| `warning-fg` | `surface` | text | 6.07 | 4.5 | Release times and warning text on cards |
| `available-fg` | `available-subtle` | text | 7.40 | 4.5 | Available badge and notice |
| `available-fg` | `surface` | text | 8.38 | 4.5 | Available text on cards and tables |
| `available` | `available-subtle` | text | 5.02 | 4.5 | Available night glyph |
| `fg-inverse` | `available` | text | 5.68 | 4.5 | Available map pill and solid badge |
| `danger-fg` | `danger-subtle` | text | 7.77 | 4.5 | Error notice |
| `danger` | `surface` | text | 6.43 | 4.5 | Field error text and danger outline button |
| `danger` | `canvas` | text | 6.02 | 4.5 | Field error text on the page |
| `danger` | `danger-subtle` | text | 5.67 | 4.5 | Danger outline button on hover |
| `fg-inverse` | `danger-fg` | text | 8.82 | 4.5 | Confirm button in a destructive dialog (solid fill) |
| `focus` | `surface` | ui | 6.38 | 3 | Focus ring on cards and dialogs |
| `focus` | `canvas` | ui | 5.97 | 3 | Focus ring on the page |
| `focus` | `surface-subtle` | ui | 5.52 | 3 | Focus ring on subtle fills |
| `border-strong` | `surface` | ui | 3.92 | 3 | Input and checkbox borders |
| `border-strong` | `canvas` | ui | 3.67 | 3 | Input borders on the page |
| `accent` | `canvas` | ui | 4.81 | 3 | Primary button shape against the page |
| `ocean-500` | `surface` | ui | 4.81 | 3 | Active-nav brushstroke |
| `brand` | `ocean-100` | ui | 4.98 | 3 | Kind icon on the photo-placeholder dab |
| `coral-400` | `surface` | ui | 4.10 | 3 | Logo coral accent, a large graphic and never text |
| `available` | `surface` | ui | 5.68 | 3 | Available map pill against white map land |
| `available` | `canvas` | ui | 5.31 | 3 | Available map pill and pin against sand map land |

Rules:

- A new colour combination is added to `CONTRAST_PAIRS` **and** this table before it ships. The doc test fails if they differ.
- Pairs that are not listed are not allowed for text. In particular, `coral-400`, `sun-400` and `sun` never carry text or sit under it. `coral-400` may be a large graphic on `surface` (the logo accent, 4.10:1); `sun-400` (1.84:1) is too light even for that, so it only ever sits beside something that carries the meaning.
- Muted text is `fg-muted` (5.19:1 or better on every light surface). The old `gray-400` (2.5:1) is gone.

## Type

Two families, both bundled with `@fontsource-variable` so the app works offline and nothing loads from a CDN.

- **Figtree** (`font-sans`, the default) is a friendly geometric sans and the closest free analogue to Airbnb Cereal. It stays legible at 12–14 px in dense lists and is small (about 20 KB per subset). Stack: `"Figtree Variable", system-ui, "Segoe UI", sans-serif`.
- **Fraunces** (`font-display`) is a "wonky" old-style serif whose optical sizing adds warmth at display sizes. We ship the `opsz.css` build (opsz and wght axes, about 67 KB). Stack: `"Fraunces Variable", Georgia, serif`.

| Token | Size / line height | Family | Use |
| --- | --- | --- | --- |
| `text-display-lg` | 48 / 52 | Fraunces 500 | Page hero, location name on the detail page |
| `text-display-md` | 36 / 42 | Fraunces 500 | Location name in a sheet or dialog |
| `text-display-sm` | 28 / 34 | Fraunces 500 | EmptyState title (an empty state that is the whole view), wordmark |
| `text-2xl` | 24 / 32 | Figtree 600 | Page title (`h1`) in app screens |
| `text-xl` | 20 / 28 | Figtree 600 | Section title (`h2`), EmptyState title under a page `h1` (`size="md"`) |
| `text-lg` | 18 / 28 | Figtree 600 | Card title, dialog title |
| `text-base` | 16 / 24 | Figtree 400 | Body, form controls |
| `text-sm` | 14 / 20 | Figtree 400 or 600 | Dense lists, labels, buttons |
| `text-xs` | 12 / 16 | Figtree 400 | Metadata and timestamps only |

Rules:

- **Fraunces only at display sizes (28 px and up)**: location names as page heroes, EmptyState titles and the wordmark. Never body text, buttons, form labels, tables, badges, or the text inside cards. At most one Fraunces element per view region.
- Weights: 400 body, 500 for Fraunces, 600 for labels, buttons and Figtree headings. 700 is reserved for the odd number that must stand out.
- Sentence case everywhere, including buttons and headings. No all-caps, letter-spaced eyebrow labels.
- Prices, dates in tables, counts and countdowns use `tabular-nums`.
- Prose is at most 70 characters wide (`max-w-2xl`).
- Nothing smaller than 12 px, and 12 px only for metadata.

## Spacing and layout

- A 4 px grid, using Tailwind's default spacing scale. The rhythm is 4, 8, 12, 16, 24, 32, 48 and 64 px.
- Inside a control or between label and control: 4–8 px. Between related controls in a group: 12–16 px. Between groups: 24–32 px. Between page sections: 48–64 px.
- Page gutters are 32 px (`px-8`), or 24 px below 1024 px wide.
- Browse layouts are at most 1280 px wide (`max-w-7xl`). Forms are one column at most 640 px wide (`max-w-xl`). Prose is at most `max-w-2xl`.
- The header is 64 px high and sticky. The minimum window is 960 × 640 (DQ3).
- Use space to group things. Hairline dividers are for lists and tables only, not for separating page sections.
- Hit targets are at least 32 px high (`sm` buttons), and 40 px by default.
- One `h1` per page.

## Radii

| Token | Value | Use |
| --- | --- | --- |
| `rounded-sm` | 6 px | Checkboxes, small tags inside other controls |
| `rounded-md` | 8 px | Buttons, inputs, selects, segmented controls |
| `rounded-lg` | 12 px | Cards, photos, menus, popovers, notices |
| `rounded-xl` | 16 px | Dialogs, sheets, hero photos |
| `rounded-2xl` | 24 px | Large hero media on the detail page |
| `rounded-full` | 9999 px | Pills: the search pill, badges, map pills, avatars, the Soon pill |

Rules:

- A nested corner is the outer radius minus the padding (a 12 px card with 4 px padding holds 8 px children).
- One radius per component. A photo at the top of a card takes the card's radius on its top corners.
- No square corners on interactive elements, and no 4 px (`rounded`) in new code.

## Elevation

Shadows are tinted with ink at low alpha, so they look like shade rather than grey smudges. Elevation tells you what is on top of what; it is not decoration.

| Token | Use |
| --- | --- |
| `shadow-card` | Cards resting on the page (paired with a hairline border) |
| `shadow-pill` | The search pill and map pills |
| `shadow-pop` | Menus, popovers, comboboxes, and a card on hover |
| `shadow-modal` | Dialogs and sheets, above a scrim |

Layers, with no other `z-index` values allowed:

| Token | Value | Use |
| --- | --- | --- |
| `z-header` | 30 | The sticky header |
| `z-tray` | 40 | The bottom-right tray (queue status, update card) |
| `z-overlay` | 50 | Dialog, sheet and popover layers, with their scrim |
| `z-toast` | 60 | Toasts |
| `z-tooltip` | 70 | Tooltips |

Rules:

- No coloured shadows and no glows.
- One floating layer at a time above the page, plus a modal if one is open.
- Never stack a shadow on a shadowed element, such as a card inside a dialog.

## Motion

| Token | Value | Use |
| --- | --- | --- |
| `duration-fast` | 120 ms | Colour and opacity on hover and press |
| `duration-base` | 200 ms | Entering and leaving: popovers, menus, dialogs, toasts |
| `duration-slow` | 320 ms | Movement across the screen: sheets, the tray, a sliding indicator |
| `ease-standard` | `cubic-bezier(.2,0,0,1)` | Everything |
| `animate-fade-in` | base, standard | Content that appears in place |
| `animate-scale-in` | base, standard, from 96% | Dialogs, popovers, menus |
| `animate-shimmer` | 1.6 s linear, looping | Skeletons only |

Rules:

- Animate opacity and transform only. Never animate layout (width, height, top, left).
- No bounces, springs or overshoot. Nothing moves on its own except a loading indicator.
- With `prefers-reduced-motion: reduce`, the duration tokens become 0 and a global reset stops every animation and transition, including the shimmer. Every state must still be reachable and understandable with no motion at all.
- Show a spinner only for waits longer than about 300 ms. Prefer a skeleton the size of the content to avoid layout shift.

## Iconography

- **lucide-react only**, at stroke **1.75** and 20 px by default. Both are set once by `<LucideProvider strokeWidth={1.75} size={20}>` (in `app/AppProviders.tsx`), so components normally pass no size or stroke.
- Sizes: 16 px in badges and dense rows, 20 px default, 24 px in empty states, 28–40 px in the photo placeholder.
- Icons use `currentColor` and take the colour of their text. A state icon takes its state's `-fg` colour.
- An icon next to text is decorative (lucide renders it `aria-hidden`). An icon-only button must have an accessible name (D2 `IconButton` requires `label`).
- Never emoji, never a second icon set, never a hand-copied SVG icon.
- lucide 1.x names: `House` (not `Home`), `LoaderCircle` (not `Loader2`), `CircleQuestionMark` (not `HelpCircle`), and import `Map as MapIcon` so the global `Map` is not shadowed.

Location kinds (`src/renderer/components/ui/kindIcons.ts`):

| Kind | Icon |
| --- | --- |
| `campground` | `TentTree` |
| `caravan-park` | `Caravan` |
| `holiday-park` | `TreePalm` |
| `cabin` | `BedDouble` |
| `hut` | `TreePine` |
| `glamping` | `Tent` |
| `farm-stay` | `Tractor` |
| `home` | `House` |
| `other` | `MapPin` |

Amenities (E1's `components/amenityIcons.ts` implements these):

| Amenity | Icon |
| --- | --- |
| Toilets | `Toilet` |
| Showers | `ShowerHead` |
| Drinking water | `Droplet` |
| Powered sites | `PlugZap` |
| Campfires allowed | `Flame` |
| Camp kitchen, barbecue | `CookingPot` |
| Dogs permitted | `Dog` |
| 2WD road access | `CarFront` |
| Wheelchair access | `Accessibility` |
| Boat ramp | `Sailboat` |
| Beach, swimming | `Waves` |
| Walk trails | `Footprints` |
| Any other facility | `MapPin` |

Availability and states:

| State | Icon |
| --- | --- |
| Available night | `Check` |
| Booked night | `X` |
| Closed night | `Minus` |
| Not released yet | `Clock` |
| Unknown | `CircleQuestionMark` |
| Loading | `LoaderCircle` |
| Success | `CircleCheck` |
| Warning | `TriangleAlert` |
| Error | `CircleAlert` |
| Information | `Info` |
| Queue, waiting room | `Hourglass` |
| Hold countdown | `Timer` |

Navigation and actions:

| Meaning | Icon |
| --- | --- |
| Explore | `Compass` |
| Watches | `BellRing` |
| Site Sniper | `CalendarClock` |
| Bookings | `CalendarCheck` |
| Settings | `Settings` |
| Account menu | `CircleUser` |
| Notifications | `Bell` |
| Search | `Search` |
| Filters | `SlidersHorizontal` |
| Dates | `CalendarRange` |
| Guests | `Users` |
| Map view | `Map` (imported as `MapIcon`) |
| List view | `List` |
| Opens the provider's site | `ExternalLink` |
| Create | `Plus` |
| Back | `ArrowLeft` |
| Expand, open a menu | `ChevronDown` |
| Close, remove | `X` |

## Imagery and placeholder

- Real photography from providers, fetched live and never redistributed (brief O8). No stock lifestyle photos, no illustrations standing in for places, and never AI-generated imagery.
- Photos are 4:3 in cards and 16:9 or 3:2 in the detail hero, `object-cover`, with `rounded-lg` (cards) or `rounded-xl` (hero).
- No filters, duotones, colour overlays or gradients on photos. Text never sits on a photo; it goes below it. Map attribution is the only overlay.
- While loading, show a skeleton of the same size (`animate-shimmer`). A missing or broken image shows `PhotoPlaceholder`, never the browser's broken-image icon.
- **`PhotoPlaceholder`** (`components/ui/PhotoPlaceholder.tsx`): a `surface-subtle` fill, a soft `ocean-100` brush dab behind the location kind icon in `brand` (4.98:1, centred on the dab's paint rather than its box), and the caption "No photo yet" in `fg-muted`. It is `role="img"` and takes a required `aria-label` such as "No photo available for Lucky Bay". `size="hero"` is used on the detail page. It fills its parent, so the parent sets the aspect ratio and radius.

## Brushstroke motif

One hand-drawn gesture, used sparingly, is what makes the app feel WA without becoming a theme park.

- The artwork is **original**: three paths drawn for WA Stay in `src/renderer/assets/brush/` (`underline.svg`, `dab.svg`, `swash.svg`), each with a rounded landing and a dry-brush tail. Nothing is traced from the WA Tourism mark (O4). B1 builds the logo from the same geometry.
- The SVGs are generated, never hand-edited: `node scripts/brand/brushstrokes.js --write` rebuilds them from seeded specs (centreline, width, bristle lanes), and a test fails if the committed files drift from the generator. The script also reports each stroke's paint centre (`BRUSH_MASS_CENTRE`).
- Render it with `<Brushstroke variant="underline | dab | swash" tone="…">`. It is always `aria-hidden` with no accessible name.
- **Colours: only `ocean-500`, `ocean-100`, `sun-400` or `sun-100`** (`tone` `ocean`, `ocean-soft`, `sun`, `sun-soft`). The component accepts nothing else.
- **Allowed places only:** under the active nav item (`underline`, `ocean`), the logo, the photo-placeholder dab (`dab`, `ocean-soft`), and the EmptyState accent (`swash`, `sun` or `ocean`).
- **At most one per region.** Never behind body text, never as a button fill or background texture, never animated, never rotated.
- The underline may stretch horizontally to fit a label. Other variants keep roughly their drawn proportions (within 1.5×).
- Because the stroke is decorative, the active nav item is also marked by `aria-current="page"` and weight 600, never by colour alone.

## Voice and tone

- **Australian English:** colour, organise, licence (noun), favourite, enrol, cancelled.
- **Sentence case** for everything: buttons, headings, menu items, tabs.
- **Buttons are verbs:** "Search", "Create watch", "Hold site", "Save changes", "Open ParkStay". Never "Submit", "OK" or "Click here".
- **Dates:** "Fri 3 Oct 2026". Ranges: "3–5 Oct" (en dash, no spaces), and "30 Oct – 2 Nov" across months (spaced en dash). Times: "12:00 am AWST", in the provider's time zone. Durations: "2 nights", "30 minutes".
- **Numbers** are always numerals: "2 sites", "1 adult". Money is "$30" or "$30.50".
- **No exclamation marks, no "Oops", no emoji**, and no jokes in errors.
- **Errors say what happened and what to do next:** "ParkStay didn't respond. Try again in a minute." Never blame the user.
- **Never claim what the app can't guarantee** (ui-review #9): "Checks every 5 minutes", not "never miss a site"; "Stored encrypted on this computer", not "never leaves your device".
- "ParkStay" appears only when naming the provider. The app is "WA Stay".

## Do and don't

| Do | Don't |
| --- | --- |
| Use semantic classes: `bg-surface`, `text-fg-muted`, `border-border-strong` | Use `bg-gray-100`, `text-blue-600`, `primary-*` or hex values in new code |
| One coral button per view, for the main action | Coral headings, links, icons or a second coral button |
| Ink outline or ghost buttons for everything else | A rainbow of coloured buttons on a card |
| Show danger as text or an outline | A solid red button anywhere except a destructive confirm |
| Fraunces for a location hero or EmptyState title | Fraunces in buttons, labels, tables or body text |
| lucide icons beside a text label | Emoji, mixed icon sets, or unlabelled icon-only buttons |
| One brushstroke in a region, in ocean or sun | Brushstrokes behind text, as button fills, or several in one card |
| Space to group content | Boxes inside boxes, nested `p-6`, dividers between sections |
| Real provider photos, or `PhotoPlaceholder` | Stock photos, gradients or filters over photos |
| `prefers-reduced-motion` respected, opacity and transform only | Looping or bouncing decoration, animated layout |
| "3–5 Oct", "Fri 3 Oct 2026" | "10/03/2026", "Oct 3rd", or US-style dates |
| Plain, honest copy with a next step | "Oops!", exclamation marks, promises the app can't keep |
