# M2 — Renderer framework upgrade: React 19, React Router 7, Tailwind 4, zod 4 and friends

## Description
Bring the renderer and shared libraries to their latest majors, so the app runs on current
frameworks (stakeholder decision 2026-10-10). Behaviour, design and accessibility must not change:
same screens, same tokens, same tests (adjusted only where an API changed).

## Size
L (no design round: the target versions are given and the UI must look the same).

## Scope
Upgrade to the latest versions (`npm view <pkg> version`):
1. **React 19** with `react-dom`, `@types/react` and `@types/react-dom`.
   - Fix React 19 breaking changes:
     - `ReactDOM.render` / `findDOMNode` / string refs / `defaultProps` on function components
       (removed);
     - `useRef` needs an argument;
     - `JSX` namespace types;
     - `forwardRef` can stay, but ref-as-prop is allowed;
     - `act` imported from `react`;
     - stricter `useEffect` cleanup typing.
   - `@testing-library/react` 16 (with `@testing-library/dom` as a peer), `@testing-library/jest-dom`
     latest, `@testing-library/user-event` latest.
2. **React Router 7** (`react-router-dom` → `react-router` 7; the `react-router-dom` re-export
   package is fine if still published).
   - Keep the HashRouter, the routes in `src/renderer/app/routes.ts`, the navigation guard
     behaviour and the scroll/focus behaviour.
   - Apply the v7 changes: future flags become the default, `json`/`defer` are removed, and
     relative splat paths.
3. **Tailwind CSS 4.**
   - Migrate `tailwind.config.js` and the design tokens (`src/renderer/styles/tokens.css`,
     `index.css`) to Tailwind 4's CSS-first configuration (`@import "tailwindcss"`, `@theme`,
     `@utility`, `@custom-variant` as needed), keeping every token name and value.
   - Use `@tailwindcss/vite` (or `@tailwindcss/postcss`) and drop `autoprefixer` if Tailwind 4 makes
     it redundant.
   - Fix the v4 renames: `shadow-sm` → `shadow-xs`, `rounded-sm` → `rounded-xs`, `outline-none` →
     `outline-hidden`, `ring` defaults, the default border colour, `bg-opacity-*`, and so on. Use
     `npx @tailwindcss/upgrade` as a starting point, then review its diff.
   - `tests/unit/design/token-guard.test.ts` must still pass and still catch raw colours.
   - **Visual parity is a completion criterion.** Take screenshots of the main screens before and
     after (fixture mode, seeded rows; the scripts from the final design review are in
     `/tmp/claude-0/-home-user/6194b22b-a9ee-5367-bec6-720762fbf758/scratchpad/final/B/`: `walk.js`
     and `seed.js`). Compare them; fix any visible difference.
4. **zod 4** (and `@hookform/resolvers` latest, `react-hook-form` latest).
   - Fix the zod 4 changes:
     - error customisation (`message` → `error`);
     - `z.string().email()` and similar moved to top-level formats (the method forms still work but
       are deprecated);
     - `.strict()`/`.passthrough()` → `z.strictObject`/`z.looseObject`;
     - `ZodError` issue shape and `flatten`;
     - `z.record` needs two arguments;
     - `.default()` semantics;
     - `z.function()`.
   - The IPC contract (`src/shared/contracts/**`) and its parity tests, `assertTypeEquals` and every
     schema test must pass. `ipc/handle.ts` must still map validation failures to `VALIDATION` with
     `issues` paths, exactly as before.
5. **@tanstack/react-query** latest, **lucide-react** latest, **date-fns 4** (if used; otherwise
   remove it), **mapbox-gl** latest 3.x, **sanitize-html** types if needed.

## Non-goals
- Electron, better-sqlite3, Node 24, electron-builder, fuses, nodemailer, playwright: task M1, in
  parallel on another lane. Do not touch `.github/workflows`, `electron-builder.json`, `src/main`
  (except shared zod schemas it imports) or the native module.
- TypeScript, Vite, Jest, ESLint, Prettier: task M3, after M1 and M2. Stay on Vite 5 and Jest 29
  here, choosing Tailwind integration and testing-library versions that work with them.
- No UI or behaviour changes.

## Completion Criteria
- [ ] `react`, `react-dom`, `react-router(-dom)`, `tailwindcss`, `zod`, `@hookform/resolvers`,
  `react-hook-form`, `@tanstack/react-query`, `@testing-library/*`, `lucide-react` and `mapbox-gl`
  are at their latest versions (list them in the report).
- [ ] `npm run lint` (0 errors), `npm run format:check`, `npm run type-check`, `npm test` and
  `npm run test:tz` pass on the lane's Node (22).
- [ ] `npm run build:e2e && xvfb-run -a npm run test:e2e` passes (Electron ABI; swap back after).
- [ ] Before and after screenshots of Explore, place, watches list and detail, new watch, snipes,
  bookings, settings (each section) and the notifications bell, at 1440 and 960, show no visible
  difference (or each difference is listed and fixed).
- [ ] axe on those screens: still 0 critical or serious.
- [ ] Token guard, API-boundary guard and branding guard pass unchanged.

## Test Strategy
- The existing 3,600+ tests are the regression net. Change a test only where an API it uses
  changed, never to weaken it.

## Context Files to Read First
- `CLAUDE.md` (renderer rules)
- `docs/design/*.md`
- `tailwind.config.js`, `postcss.config.js`, `vite.config.ts`
- `src/renderer/styles/*`, `src/renderer/app/*`
- `src/shared/contracts/*`, `src/main/ipc/handle.ts`
