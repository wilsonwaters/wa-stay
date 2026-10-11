# M3 — Build and test tooling upgrade: TypeScript 6, Vite 8, Jest 30, ESLint 10

## Description
After M1 (platform) and M2 (frameworks), bring the build, lint and test tooling to current
versions on Node 24 (stakeholder decision 2026-10-10: latest frameworks and libraries).

**TypeScript:** use the latest **6.x**, not 7. TypeScript 7 (the native compiler) is out, but
`typescript-eslint` supports `typescript >=4.8.4 <6.1.0` and `ts-jest` `<7`, and
`tests/unit/shared/type-equality.test.ts` uses the TypeScript compiler API. Record this in the
report and in `CLAUDE.md`'s Tech Stack. Optionally add `@typescript/native-preview` as an extra
fast `type-check:fast` script only if it type-checks the project cleanly; it must not replace
`npm run type-check`.

## Size
L

## Scope
Upgrade to the latest versions (`npm view <pkg> version`), on Node 24:
1. **TypeScript 6.x** and the `tsconfig*.json` files:
   - new defaults and deprecations in 6.0, such as `moduleResolution: node10` → `bundler`/`node16`
     where appropriate;
   - `baseUrl` deprecation and `paths`;
   - `esModuleInterop`;
   - `types`.

   `tsc-alias` latest; `tsconfig-paths` latest (dev).
2. **Vite 8** and `@vitejs/plugin-react` latest.
   - `vite.config.ts`: the CSP plugin, the Mapbox token check (a `sk.` token fails the build), the
     dev-server port 3000, `build:e2e`, and asset paths for `file://` loading must behave the same.
   - Tailwind's Vite plugin (from M2) at its latest version.
   - `tests/integration/renderer-csp.test.ts` and the built-renderer tests must pass.
3. **Jest 30**, with `jest-environment-jsdom` 30, `@types/jest` 30 and `ts-jest` latest. Migrate
   `jest.config.js` for Jest 30's changes:
   - `testPathPattern` → `testPathPatterns`;
   - removed `jest.genMockFromModule`;
   - jsdom 26 behaviour;
   - snapshot format;
   - `--coverage` with `v8` vs `babel` (keep the current provider unless it breaks the
     thresholds);
   - `expect.toBeCalled*` aliases removed.

   Keep the two projects, setup files, coverage thresholds and `test:tz`.
4. **ESLint 10** with flat config (`eslint.config.js` replacing `.eslintrc*`):
   - `typescript-eslint` 8 (the unified package);
   - `eslint-plugin-react-hooks` latest;
   - `eslint-config-prettier` latest;
   - any other plugins in use.

   Keep the current rule set's intent. New recommended rules that flag existing code: fix the code
   where the rule finds a real problem; otherwise turn that rule off with a one-line reason in the
   config. Never weaken an existing rule. `npm run lint` must keep checking `src` (and add `tests`
   and `scripts` if cheap). The `lint` script drops the removed `--ext` flag.
5. **Prettier** latest. If formatting changes, reformat in a separate commit so the diff is
   reviewable.
6. Small dev tools to latest:
   - `concurrently`, `rimraf`, `cross-env`;
   - `husky` 9 (new `.husky/` layout, `prepare` script) and `lint-staged`;
   - `electron-devtools-installer` (if still used, else remove);
   - `sharp`, `png-to-ico`;
   - `@types/*`.
7. **React Router 8** (`react-router` latest, ES-module-only, Node >= 22.22). M2 moved to 7 because
   Jest 29 cannot load ES-module-only packages. With Jest 30, either transform it (as M1 does for
   htmlparser2 in `jest.config.js`) or load it natively. Apply its breaking changes, and keep the
   HashRouter, routes, navigation guard, `app:navigate` deep links and prefill queries as they are.
8. CI and docs: the scripts and commands in `CLAUDE.md`, `docs/development.md` and
   `tests/README.md` match.

## Non-goals
No runtime, UI or behaviour changes. Do not revisit M1's or M2's packages except to resolve peer
dependencies.

## Completion Criteria
- [ ] On Node 24, these pass:
  - `npm ci`;
  - `npm run lint` (0 errors), `npm run format:check` and `npm run type-check`;
  - `npm test` and `npm run test:tz`;
  - `npm run test:coverage` (thresholds unchanged), `npm run build` and `npm run build:e2e`.
- [ ] `xvfb-run -a npm run test:e2e` passes, and so do `npm run test:electron` and
  `npm run smoke:packaged`.
- [ ] `npm outdated` shows nothing behind its latest major. The exceptions are TypeScript (6.x by
  design) and any package listed in the report with a reason.
- [ ] The report gives an old → new version table.

## Context Files to Read First
- `CLAUDE.md`
- `package.json`, `tsconfig*.json`, `vite.config.ts`, `jest.config.js`, `.eslintrc*`,
  `.prettierrc*`, `.husky/`
- `scripts/*`
- `.github/workflows/*.yml`
