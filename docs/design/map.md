# WA Stay map

Explore's map (E1): Mapbox GL JS v3 on Mapbox's `outdoors-v12` style, recoloured at run time to the WA Stay palette, with the app's own clustered pins and name pills. The base map is calm and the pins are not: ink pins and clusters are the strongest marks on it. The code is in `src/renderer/features/explore/map/`; the rules for colour and type are in [design-language.md](design-language.md).

| File | What |
| --- | --- |
| `mapboxController.ts` | The only module that imports `mapbox-gl` (and its CSS), by dynamic import. Implements `MapController` (`types.ts`). |
| `MapView.tsx` | The React side, lazy-loaded: creates one controller, syncs data, hover and selection, the preview, "Search as I move the map". |
| `waPalette.ts` | `applyWaPalette(map, tokens)`: the recolouring below, on every `style.load`. |
| `../results/order.ts` | The list's order beside the map (components.md, "Explore's default order"). |
| `layers.ts` | `buildLayers(tokens)`, the source settings and the SDF pill image. Pure. |
| `geo.ts` | `toFeatureCollection`, `withinBbox`, `boundsOf`, `pillLabel`. Pure. |
| `mapboxToken.ts`, `webgl.ts`, `mapSupport.ts` | Whether the map can be shown at all. |

## Why outdoors-v12

- Most places are in national parks. Outdoors draws park boundaries, hillshade, contours and unsealed tracks, which matter for 2WD and 4WD trips.
- Recolouring land, water and parks gives the calm WA palette without an account-owned Studio style.
- Mapbox Standard was rejected: its basemap is an imported style that `setPaintProperty` cannot reach (it only has config properties), and it defaults to 3D and the globe. `light-v11` has no terrain or tracks.

## Recolouring

Colours come from the design tokens (`readMapTokens()` reads the `--ws-*` variables), never from hex in code. Every change is guarded by `map.getLayer(id)`: a layer Mapbox renames or drops is skipped and logged once in development, never an error.

| Layer (type) | Property | Value | Why |
| --- | --- | --- | --- |
| `land` (background) | `background-color` | `sand-50` | The page's canvas colour |
| `water` (fill) | `fill-color` | `ocean-100` | Pale Indian Ocean |
| `water-depth` (fill) | `fill-opacity` | 0 | Bathymetry darkens the sea at the zooms WA is seen at, hiding `ocean-100` |
| `water-shadow` (fill), `waterway-shadow` (line) | colour | `ocean-200` | Mapbox's deep-blue edge, softened |
| `waterway` (line) | `line-color` | `ocean-200` | Rivers and creeks |
| `landcover` (fill) | `fill-opacity` | 0.3 at z4, 0.25 at z8, 0 at z12 | Vegetation keeps its shapes at a third of Mapbox's strength, so its bright greens never outshout the pins |
| `national-park` (fill) | `fill-color`, `fill-opacity` | `eucalypt-50`, solid from z6 | Mapbox fades parks to 20%, which vanishes on sand |
| `national-park_tint-band` (line) | `line-color`, `line-opacity` | `eucalypt-600`, 0.3 | A soft edge, so park boundaries read at every zoom |
| `landuse` (fill) | `fill-color`, class `park` only | `eucalypt-50` | Every other class (school, hospital, …) keeps Mapbox's colour; the zoom interpolation is kept |
| `hillshade` (fill) | `fill-opacity` | 0.5 | Outdoors draws hillshade as a **fill** layer, not a raster with `hillshade-exaggeration`, so it is quietened with opacity: half strength, the equivalent of exaggeration 0.25 |
| `contour-line` (line), `contour-label` (symbol) | opacity | 0.3 | Terrain stays a hint |
| `poi-label`, `road-number-shield`, `road-exit-shield`, `airport-label`, `transit-label` (symbol) | `visibility` | `none` | Mapbox's green park markers, highway shields, airports and stations outranked the pins at zoom 5 to 8. Places to stay are the only points on this map; park names still show as their eucalypt shapes |
| `road-motorway-trunk`, `road-major-link` and their `bridge-*` and `tunnel-*` twins (line) | `line-color`, `line-opacity` | `sand-500` at 40% to zoom 10, then white at full strength | Mapbox draws highways orange and yellow. Faint sand keeps the main roads readable for orientation without competing; from street zooms roads are white, like every other road |
| The 23 road casings (`*-case`, line) | `line-color` | `sand-200`; tracks (`class: track`) `sand-500` | Casings in sand. Unsealed tracks keep a darker casing, so 2WD and 4WD routes still read |
| `settlement-major-label`, `settlement-minor-label`, `settlement-subdivision-label`, `road-label` (symbol) | `text-color`, `text-halo-color` | `ink-700` on white | Town, suburb and road names subdued from Mapbox's black, still legible (ink-700 on white is 10.60:1, `fg-secondary`/`surface`) |
| `settlement-major-label`, `settlement-minor-label` | `icon-opacity` | 0.5 | Town dots dimmed, so they are not mistaken for pins |
| `state-label` (symbol) | `text-color` | `ink-700` | Mapbox keeps it at half opacity |
| `admin-1-boundary`, `admin-1-boundary-bg` (line) | `line-color` | `sand-500`, `sand-200` | The state border, pink in Mapbox, in sand |

### Verified layer list (2026-10-04)

`outdoors-v12` had 148 layers when E1 was built. The ones above, in the style's order: `land`, `landcover`, `national-park`, `national-park_tint-band`, `landuse`, `waterway-shadow`, `water-shadow`, `waterway`, `water`, `water-depth`, `hillshade`, `contour-line`, …, `contour-label`. The rest, by group: `pitch-outline`, `wetland`/`wetland-pattern`, `aeroway-*` (2), `building-*` (4), `land-structure-*` (2), `tunnel-*` (23), `cliff`, `ferry*` (3), `road-*` (35), `golf-*` (2), `turning-feature*` (2), `level-crossing`, `crosswalks`, `gate-*` (2), `bridge-*` (32), `aerialway`, `admin-*` (5), `block-number-label`, `path-pedestrian-label`, `natural-*` (2), `poi-label`, `transit-label`, `airport-label`, `settlement-*` (3), `state-label`, `country-label`, `continent-label`. Labels use `DIN Pro` with `Arial Unicode MS` fallbacks, which the app's own labels reuse (no extra font downloads).

The road layer ids above were checked against the style again on 2026-10-09 (148 layers). To re-check after a Mapbox style update, fetch `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12?access_token=…` and compare the ids in the table; the development console names any that went missing.

## Camera and controls

- `projection: 'mercator'`, `dragRotate: false`, `pitchWithRotate: false`, `touchPitch: false`, touch rotation off, `renderWorldCopies: false`, `minZoom: 3`.
- First view: WA, `[[112.5, -35.6], [129.2, -13.5]]` with 32 px padding, unless the URL has `map=lng,lat,zoom`.
- `map=` is the person's camera, never the app's. It is written (`replace`, 500 ms after the map stops) only for moves the person makes: dragging, the wheel, the keyboard, the zoom buttons, a click on a cluster (`MapViewState.userInitiated`: Mapbox's `originalEvent` is a mouse, wheel, keyboard or touch event, and the cluster click passes its click on). The first view, a fit to results, a pan to fit a popup, a fly and a window resize are never written: Mapbox also ends a move with the window's `resize`, `orientationchange` or `fullscreenchange` event, which is not the person's. Choosing a place in Where writes its camera at once, with the selection, in one history entry, because the person chose where the map goes.
- A new search (text or filters, not the map area) drops `map=` and fits the map to its results, up to zoom 11, keeping clear of "Search as I move the map" at the top (its measured height plus 16 px; 48 px on the other sides). No results: the camera stays. Opened at a search with no `map=` (a link, or Back), the first results are framed at once, without animation.
- `NavigationControl` without the compass, top-right, with the pill shadow and the app's focus ring. The Mapbox logo and a compact `AttributionControl` bottom-left, clear of the tray (bottom-right). Both must stay visible (Mapbox terms).

## Pins

| Layer | Look |
| --- | --- |
| `clusters` + `cluster-count` | Ink circle, white 2 px ring, white count (DIN Pro Bold 12, which the style already loads for state names). Radius 15, 19 from 10 places, 23 from 50. Clustered within 48 px up to zoom 10. |
| `location-halo` | Behind a hovered or selected pin only: an ink circle at 16% opacity, radius 16. |
| `location-dot` | Filled ink pin, white 2 px ring, radius 6. Hovered or selected (feature state): radius 9, white 3 px ring, with the halo. Pins never collide, so every place stays visible. |
| `location-pill` | From zoom 8: the name, cut to 22 characters with "…", on a white SDF pill with an ink 1 px outline (`icon-text-fit: both`). Ink with white text while hovered or selected. Faded out (feature state `previewed`) while the place's preview is open. Overlapping pills hide; their pins stay. With dates, the availability instead (below). |
| DOM marker | One ink pill (Figtree, `shadow-pill`) for the hovered or selected place, above everything, even inside a cluster. Not shown for the place whose preview is open: the preview already names it. Decorative (`aria-hidden`): the card and the preview carry the name. |

Without dates, the app's layers use only ink and white (a test checks it). Ink on white and white on ink are 17.79:1 (`fg`/`surface`, `fg-inverse`/`surface-inverse` in the contrast table); an ink pin on sand land is 16.65:1 (`fg`/`canvas`), while the darkest marks on the base map, its place names, are ink-700.

### With dates (E3)

Once dates are set in the search pill, every pill says how its place stands for the stay, at every zoom where the place is on its own (not only from zoom 8), instead of its name. The name stays in the preview and the DOM marker. The words carry the state; the colour repeats it.

| State | Pill | Pill fill and text | Pin |
| --- | --- | --- | --- |
| A unit free every night | "8 available" | eucalypt-600, white (`fg-inverse`/`available`, 5.68:1) | filled eucalypt, white ring (`available`/`canvas`, 5.31:1) |
| No unit free every night, or nothing open for the dates | "None free", "Not open" | sand-100, sand-600 (`fg-muted`/`surface-subtle`, 5.19:1) | filled sand-600, white ring (`fg-muted`/`canvas`, 5.60:1) |
| Not bookable online | "Info only", only from zoom 8 | white, sand-600 (`fg-muted`/`surface`, 5.99:1), sand-500 outline (`border-strong`/`canvas`, 3.67:1) | hollow: white, sand-600 ring |
| Checked one place at a time, not shared, unknown or failed | "Check dates", "–" | white, ink | hollow: white, ink ring |
| Checking | "···" | white, ink, its fill pulsing | hollow: white, ink ring |

- "None free", not "Full": a provider's "no unit free for the whole stay" (ParkStay's `total_bookable` 0) also covers nights free on different units, closed nights and nights not released yet. Cards say "No site free every night".
- Pills keep a 1 px outline (ink, or sand-500 for "Info only"), and hovered or selected pills still turn ink with white text. Available pills are placed first where pills collide (`symbol-sort-key`), so a free place is never hidden behind another. "Info only" pills wait for zoom 8, like the names, so at state zoom only their quiet hollow pins show and availability stands out.
- Clusters holding an available place turn eucalypt (the source's `clusterProperties.availableCount`) and say how many places are available ("12" over "available", the pills' and cards' word, 52 px across at least), so green clusters still tell apart when most places are available. Other clusters keep their place count.
- While a provider is checking, the fill of each checking pill ("···") steps between 0.8 and 1 every 700 ms (`icon-opacity` with a 700 ms `icon-opacity-transition`), never so faint that the base map's labels show through its text. Pills with their answer stay solid. One interval in `MapView` drives it; it stops when every provider has answered and when the map goes. Under reduced motion it does not pulse.
- A small key sits under "Search as I move the map", only with dates, drawn as the pins are (a list named "Map key"): "Available" (a eucalypt dot), "None free or not open" (a muted dot), and, only when such places are on the map, "Not bookable online" (a hollow muted dot) and "Not checked" (a hollow ink dot).
- `cluster-count`'s white text is written as a feature-state expression (`['case', ACTIVE, white, white]`). Mapbox GL 3 redraws every symbol layer of a tile when another one's paint changes or transitions (the pulse, dates set or cleared), and while places have feature state it throws on a symbol layer that is not state dependent.
- `setData` replaces the source's data once per change of places or availability, never per hover. Switching between names and availability restyles the pill, pin and cluster layers in place (`syncLayers`: only the properties, filters and zoom ranges that differ); feature state is kept.
- **Teardown.** After `destroy()` every controller call is a no-op (Mapbox throws on a removed map), and `MapView` removes the map in its last effect, so every other cleanup, the pulse's last step included, still reaches a live map. Leaving Explore mid-check is safe.
- Availability is one bulk call per provider for the whole catalogue (`catalog.availability`), asked 400 ms after the stay settles, and cached by the stay fields the provider reads (`bulkAvailabilityStayFields`; ParkStay: the dates and gear type), so changing guests asks ParkStay nothing. Panning, zooming and "Search this area" ask nothing.

The pill image is a signed distance field drawn in code (`pillImage()`): alpha 0.75 on the edge, falling 1/8 per pixel outwards at the image's pixel ratio, which is what Mapbox's SDF shader expects. That lets one image be recoloured and outlined per feature.

## Interactions

- Hovering or focusing a card highlights its pin (feature state and the DOM marker); hovering a pin highlights its card, without scrolling. The highlight lives in a small store outside React state, so only the two cards whose highlight changes re-render.
- Clicking a pin selects the place (`sel` in the URL), adds its card to the page if it is further down the list, scrolls it into view (`block: 'nearest'`) and opens a preview in a Mapbox popup: photo, full name, area, the provider badge with its short name (§12.9), "View details" (which opens the place with Explore's stay, like a card). Escape, its close button or a click on empty map closes it. Closing it from inside (its button, or Escape with focus in it) returns focus to the place's card, or to the map when the card is not on screen.
- The popup is a card in the app's style (`index.css`: `radius-xl`, no padding of its own, `shadow-pop`, no tip). Mapbox picks the side of the pin it opens on; if it would still not fit (a tall preview in a short map), the map pans just enough to bring it inside, clear of "Search as I move the map" and 12 px from the edges, after any fly to the place has landed.
- Clicking a cluster eases to its expansion zoom. If its places share one spot (zooming cannot separate them), or several dots are under the pointer, a list of them opens instead.
- "Search as I move the map" (a `Switch`, on by default, `follow=0` when off) narrows the list to the visible area in the renderer: panning never calls IPC. It narrows only once the person has moved the map over the results on screen (or opened Explore at a camera of theirs, or landed on a place they chose): until then the heading reads "169 places", after it "12 places in map area". A new search shows all of its results at once and announces their count; the fit that frames them never narrows the list, so there is no flash of "No places in this part of the map" while the camera travels. Off, moving the map shows "Search this area", which narrows the list to the area at that moment.
- The visible area is the whole canvas (`map.unproject` of its corners), not `map.getBounds()`: Mapbox GL keeps the `padding` given to `fitBounds` as camera padding, and `getBounds()` leaves that margin out, so places fitted into the margin would drop out of "in map area".
- Below 1024 px one pane shows at a time, switched by the ink "Show map" / "Show list" pill, which moves focus to the revealed pane's heading. The map stays mounted (invisible, still sized) and is resized when shown, so it is never re-created and its camera is kept.

## When there is no map

Explore becomes a full-width list with an info notice when:

- the build has no token: "The map isn't available in this build, so places are shown as a list." Development builds add "Set MAPBOX_ACCESS_TOKEN in .env to enable it.";
- the computer has no WebGL: "This computer can't show the map, so places are shown as a list.";
- the map fails to load (a refused token, no network, a style error, 30 s without loading): "The map couldn't load, so places are shown as a list." with "Try again".

Nothing is requested from Mapbox in the first two cases: `mapbox-gl` is only imported when the map is created.

## Token

- `MAPBOX_ACCESS_TOKEN`, a **public** `pk.` token with public scopes only: it is bundled into the renderer, where anyone can read it. URL restrictions do not apply to `file://` (EQ5).
- `vite.config.ts` loads the repo-root `.env` explicitly (`loadEnv(mode, __dirname, '')`, since the Vite root is `src/renderer`) and takes `process.env.MAPBOX_ACCESS_TOKEN ?? .env ?? ''`, so CI's secret and `build:e2e`'s empty value win. It is exposed only as `define: { __MAPBOX_ACCESS_TOKEN__ }`, never through `envPrefix`. A secret `sk.` token fails the build.
- Local development: copy `.env.example` to `.env` (gitignored) and set the token. CI: the `MAPBOX_ACCESS_TOKEN` repository secret (or variable) is passed to the build steps in `build.yml` and `ci.yml`. The e2e build never has one.

## Content Security Policy

Allowed by `src/main/app/csp.ts` (P4): `connect-src https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com`, `img-src … https:`, `worker-src blob:`, `child-src blob:`. Never block `events.mapbox.com`: Mapbox counts map loads there (terms).
