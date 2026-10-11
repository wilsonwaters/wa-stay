# PD3: The campground map (PDF) in the app

## Description
ParkStay campgrounds have a one-page PDF "campground map" (mud map) showing where the sites are. The stakeholder wants to see it in the app. The availability view already carries its path (`map`), and the app drops it today. The PDF is public, but `X-Frame-Options: DENY` rules out an iframe (`ai-state/research/parkstay-details.md` §4).

## Size
M

## Scope
1. **Generic model:** `LocationDetail.documents?: { id: string; kind: 'map' | 'document'; title: string; mediaType: string }[]`.
   - The URL is not sent to the renderer.
   - ParkStay maps `view.map` to one `{ id: 'campground-map', kind: 'map', title: 'Campground map', mediaType: 'application/pdf' }`. It keeps the resolved https URL main-side: resolve it against `PARKSTAY_BASE_URL` and refuse anything off ParkStay's origin or not https.
   - The detail cache holds it.
2. **Opening it:** a new IPC method, `catalog.openDocument({ locationKey, documentId })`.
   - **Main resolves the URL** from the cached detail; the renderer never sends a URL. It opens it in a **document window**.
   - **The document window:**
     - a new kind next to the provider windows in `src/main/app/provider-windows.ts`, or a sibling module;
     - sandboxed, with context isolation, no preload and no app script;
     - Electron's built-in PDF viewer, `plugins: true` for this window only;
     - its own non-persistent partition, so no provider cookies;
     - navigation, new windows, downloads beyond the viewer's own, permissions and certificates refused;
     - the top level allowed only on that document's URL;
     - titled "<place> · Campground map".
   - **If the response is not `application/pdf`** (ParkStay may answer a missing file with 200 `text/plain` "ERROR opening file"), close the window and return `PROVIDER_ERROR` with a plain message.
   - **A second open** of the same document focuses the open window.
   - **On quit,** the window is closed by the existing quit path.
   - **The contract:** add the channel, the definition, the handler and the preload mapper; the parity tests enforce all four.
3. **Fixture mode and tests:**
   - In fixture mode the document window must not reach the network. Serve the PDF from `tests/e2e/fixtures/http/parkstay/` (a small real map PDF, or a tiny generated one-page PDF) on that partition, for example with `protocol.handle`, honoured only when `runsFromSource`, as the other test hooks are.
   - Unit-test the URL resolution and refusal.
   - An e2e journey: open a place, press "Campground map", see a window titled "… · Campground map" open, and see that no request left the fixture.
   - The live Electron suite (`tests/electron/`) gains a check that the window refuses navigation off the document URL, against a loopback server.
4. **The place page:** in the About area, a "Campground map" button (lucide `Map` icon plus text) when the detail has a map document. It calls `catalog.openDocument`. While it opens it shows "Opening…"; errors appear as a toast.
5. **Docs:**
   - `docs/security.md`: the document window's rules.
   - `endpoints.md`: the media row is now used.
   - CLAUDE.md's IPC table: `catalog.openDocument`.

## Non-goals
Rendering PDFs in the main window; maps for other providers (the model allows them); saving or printing beyond what the viewer offers.

## Completion Criteria
- [ ] Main-side resolution with the origin and https checks, unit-tested; no URL crosses IPC.
- [ ] The document window is configured as listed and checked in a unit test with the Electron fakes, plus the live Electron navigation check.
- [ ] A non-PDF answer closes the window with `PROVIDER_ERROR`, tested.
- [ ] The place page button shows only when there is a map, with a renderer test; the e2e journey passes in fixture mode.
- [ ] Runtime screenshots: the button, and the open map window, using the real Bungarra map fetched once anonymously, or the fixture.
- [ ] The gate passes on Node 24: lint, format, type-check, `npm test`, `test:tz`, `build:e2e` + e2e, and `test:electron`.
- [ ] Docs updated (`security.md`, `endpoints.md`, CLAUDE.md).

## Context Files to Read First
- `ai-state/research/parkstay-details.md`
- `src/main/app/provider-windows.ts` and its tests
- `src/main/app/main-window.ts` (the permission handler)
- `src/main/testing/` (fixture mode and the network guard)
- `src/shared/contracts/catalog.ts`, `src/main/ipc/handlers/catalog.handlers.ts`, `src/preload/index.ts`
- `src/renderer/features/place/`
- `docs/security.md`
