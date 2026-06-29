# CLAUDE.md

Operational guide for working in this repo. Product overview is in
[`README.md`](README.md); the deep architecture / promotion / versioning
narrative is in [`docs/architecture.md`](docs/architecture.md); the
accounts/payments/admin backend is in
[`functions/README.md`](functions/README.md).

## What this is

**Blotterbook** is a client-side trading journal and cost dashboard for futures
traders. It parses a balance-history CSV (TradingView and other platforms)
entirely in the browser, stores it locally in IndexedDB, and renders
performance / calendar / cost / tax / stats views. **No trade data ever leaves
the browser.** It's a Vite-built Svelte 5 SPA (ADR-001) that deploys to
Cloudflare Pages (build → `dist/`) plus `/functions/*` edge functions.

## Hard constraints (do not break these)

- **Compute happens locally — no trade data ever leaves the browser** *(hard — the
  product moat)*. All parsing, metrics, and storage are client-side; no telemetry, no
  analytics, no trade-data egress, ever — this gates every dependency. The paid sync tier
  stays zero-knowledge / E2E-encrypted. **This is the one pillar that does not bend.**
- **Dependencies: minimal, pinned, audited** *(policy — was "no runtime dependencies",
  relaxed by [ADR-001](docs/adr-001-vite-svelte-spa.md))*. Blotterbook is adopting a **Vite
  build + Svelte SPA** on the `/app/` surface to enable the complex-UI roadmap
  (R11/R12/R13/F23); marketing pages stay static. Dependencies are allowed where they earn
  their weight (framework, charting, layout libs); small utilities stay hand-written. Pin every
  version + commit the lockfile; treat the supply chain as a security control (guardrail
  **A28**). The pure-logic core (adapters/compute/costModel/tax/Store/util) is migrated
  **verbatim** (guardrail **A29**). Migration is phased: **A26** (Vite infra + deploy-contract
  reversal) → **A27** (Svelte on staging) → prod/demo. Dev-only tooling (ESLint/Prettier/
  Playwright) came earlier in R19 Tier A. See
  [`docs/adr-001-vite-svelte-spa.md`](docs/adr-001-vite-svelte-spa.md),
  [`docs/build-step-decision.md`](docs/build-step-decision.md), and the design pillars in
  [`docs/architecture.md`](docs/architecture.md#design-pillars).
- **Must be served over http(s).** The app `fetch()`es `/data/*.json`, so opening
  files from disk breaks it. Use a static server.
- **The `/app/` surface is a Svelte 5 SPA** (ADR-001; A26 Vite, A27 staging, A33 cutover). All three
  surfaces — `app/app.html`, `app/demo.html`, `app/staging.html` — are hand-authored, marker-free
  mount points (`<div id="app">` + `<script type="module" src="./main.ts">`, body
  `data-mode="app|demo|staging"`). The Svelte app lives in `src/app/` (App.svelte +
  components/ + lib/{modal,actions,files,flags}.ts; dir rename is A30) and reuses the **pure-logic core verbatim**
  (A29, JS→TS per A61): `adapters` / `compute`+`costModel` in `core.ts` / `store` / `sampledata` / `demostore` /
  `curveseries` / `report` (all `src/lib/*.ts`), with [`format.ts`](src/lib/format.ts) shared by the app *and* the info
  pages. Component CSS is scoped (Vite extracts it to a linked stylesheet); cross-component state is
  Svelte runes (`$state`/`$derived`), not a shared globals object. The mode-aware store seam (context
  `'bb:store'`) picks the real IndexedDB `Store` (app/staging) or the in-memory `DemoStore` (demo, so
  **demo persists nothing** — by construction). *(The former vanilla view layer — render/ui/widgets/
  datamanager/export/main/state.js + `partials/app-*.html` — was deleted in A33.)*
- **The committed HTML and data manifest are generated artifacts** that must stay
  in sync with their sources — CI fails if they drift (see Commands).

## Commands

```bash
# One-time: install pinned deps (Vite + dev tooling) from the lockfile
npm ci

# Build the deploy artifact (ADR-001/A26; A30 src/+static split; A69 site→Svelte SSG). Emits dist/.
npm run build                    # build-manifest + vite build (root:src, publicDir:static; site pages prerendered) → dist/
npm run dev                      # Vite dev server (HMR) for local development
npm run preview                  # serve the built dist/ locally (production-like)

# Tests / lint (the CI suite — run before pushing)
npm test                         # = lint + typecheck + format:check + test:unit
npm run test:unit                # the 6 node suites: adapters / auth / version / flags / tax / demostore
npm run lint                     # ESLint (flat config; .ts skipped — typechecked instead, A79)
npm run typecheck                # tsc (src/lib core, strict) + tsc(functions) + svelte-check (src/app) — A61
npm run test:e2e                 # Playwright render tests — BUILDS then serves dist/, boots every surface
npm run format                   # Prettier
# (the node suites still run standalone too, e.g. `node scripts/test-adapters.mjs`)

# Build sub-step (idempotent; commit its output — it writes a COMMITTED source, not dist/)
node scripts/build-manifest.mjs  # regenerate static/data/manifest.json content hashes (cache-busting)
# (build-includes.mjs retired by A69 — the nav/footer partials became Nav/Footer.svelte; the site
#  pages are prerendered to static HTML at build time by scripts/vite-ssg.mjs. copy-static.mjs retired by A30.)
```

> **Deploy artifact = `dist/` (gitignored), built by Vite (ADR-001/A26).** The repo root is no
> longer the web root — Cloudflare Pages runs `npm run build` and serves `dist/`. URLs are preserved
> 1:1, source files were not moved, and `functions/`/`scripts/` stay at the root (unserved; `partials/`
> retired by A69). Pages dashboard settings (build command `npm run build`, output dir `dist`, unset
> `SKIP_DEPENDENCY_INSTALL`) are recorded in [the ADR](docs/adr-001-vite-svelte-spa.md). The Svelte
> migration is complete: A27 brought Svelte to staging, and the **A33 cutover** moved all three
> surfaces (app/demo/staging) to the Svelte SPA and deleted the vanilla view layer.

CI (`.github/workflows/ci.yml`) runs `npm ci` → lint → typecheck → format → the unit/logic
tests → **the Vite build** → the Playwright render tests (against `dist/`), then re-runs the
manifest build script and **fails if the result differs from what's committed** (the drift gate;
`dist/` is gitignored, so this proves the build-time tooling didn't leave committed sources stale).
So:

- **After editing any `static/data/*.json` →** run `build-manifest.mjs` and commit the
  regenerated `static/data/manifest.json`.
- *(A69 retired the build-includes half of the drift gate: the nav/footer are now `Nav.svelte` /
  `Footer.svelte`, and the site pages are prerendered to static HTML at build time — there is no
  longer any committed HTML generated from partials.)*

## Conventions

- **Never hand-edit `data/versions.json`.** Versioning is automated from commit
  type + changed paths on push to `main` (CH12). See
  [docs/architecture.md](docs/architecture.md#versioning--releases-ch12). Don't
  set `prod` to the staging number.
- **PR titles are conventional commits** and drive the version bump: `feat:` →
  minor, `fix:`/`chore:`/`refactor:` → patch, `feat!:` / `BREAKING CHANGE:` →
  major.
- **App surfaces & their sources (A33).** All three — `app/app.html`, `app/demo.html`,
  `app/staging.html` — are hand-authored, marker-free **Svelte mount points** that load
  `src/app/main.ts` and differ only by `<body data-mode="app|demo|staging">`. Edit the
  Svelte components in `src/app/`, not the HTML shells. (The old `partials/app-*.html`
  single-source shells were deleted in A33.)
- **Demo must never mutate or persist.** Demo mounts the Svelte app with `data-mode="demo"` → the
  in-memory `DemoStore`, so **nothing reaches IndexedDB or localStorage by construction**. On top of
  that, every data-writing control is `disabled` when `PAGE_MODE === 'demo'` and each write path is
  guarded (`if (isDemo) return;`). When adding a write, confirm both. (e2e asserts no Blotterbook
  IndexedDB is created on demo.)
- **Design tokens live only in `tokens.css`** — every page links it (app surfaces, homepage, and the
  info/admin pages); Svelte components read the token CSS vars. Don't duplicate colors/fonts. (A69
  folded the old `home.css`/`site.css`/`admin.css` into scoped component `<style>` blocks.)
- **Marketing/info site = Svelte SSG (A69).** `index/howto/roadmap/changelog/legal/admin.html` are
  hand-authored, marker-free **templates** (head meta + tokens link + `<div id="app"><!--ssg-outlet--></div>`
  + a client-entry `<script>`). At build time [`vite-ssg.mjs`](scripts/vite-ssg.mjs) server-renders each page
  component (`src/site/components/*.svelte`) into the outlet (static HTML for SEO + first paint), and
  the client entry hydrates it. Edit the **components** (`src/site/components/` + shared
  `src/site/lib/{Nav,Footer,SiteShell}.svelte`), not the HTML shells. NOT behind the app SPA shell
  (ADR-001); no SvelteKit (A62). Keep CSP `style-src 'self'` — no inline `style=""`; use a CSSOM
  action for dynamic styles (A55). admin stays Cloudflare Access–gated + noindex.
- **Edit data through the `Store` interface only** (`src/lib/store.ts`) — never touch
  `indexedDB` directly. A future `CloudStore` implements the same interface.
- **The user-facing changelog is hand-curated** in `data/changelog.json` (not raw
  commits). Add an entry when `prod` bumps.

## Svelte MCP server

The official Svelte remote MCP server is wired up in
[`.claude/settings.json`](.claude/settings.json) (`https://mcp.svelte.dev/mcp`). Use its tools when
writing or changing any Svelte code:

- **`list-sections`** — call FIRST to discover the available Svelte 5 docs sections.
- **`get-documentation`** — after `list-sections`, fetch every section relevant to the task before
  writing code.
- **`svelte-autofixer`** — run on ALL Svelte code before presenting it; keep calling until it
  returns no issues/suggestions.
- **`playground-link`** — only when the user explicitly asks, and NEVER for code already written to
  files in this repo.

## Frontend conventions (Svelte 5 / TS / JSDoc)

This is a Svelte 5 SPA in TypeScript built with Vite — **not SvelteKit** (A62). The repo already
conforms to the rules below; keep it that way.

- **Svelte 5 runes only.** Props are `$props()` (never `export let`); reactive state is `$state()`
  (never a bare `let`); derived values are `$derived()` (never `$:`); side effects are `$effect()`
  (never `$:` blocks). Don't introduce `createEventDispatcher` — use callback props. Cross-component
  state here is Svelte **runes + `context('bb:store')`**, not a globals object or `svelte/store`
  writables; a shared-reactive-state module would be a `.svelte.ts` file, but none exist today.
- **File extensions.** Components with a template → `.svelte` (all carry `<script lang="ts">`, A61);
  shared reactive-state-with-runes modules → `.svelte.ts`; pure logic / utilities / API calls /
  types → `.ts`. No hand-written `.js` in `src/` (the pure-logic core is native TS — A61).
- **TypeScript.** `src/` is `any`-free — keep it that way: prefer proper types or `unknown`, and put
  shared interfaces in [`src/lib/types.ts`](src/lib/types.ts), not inline. Type fetched/persisted JSON
  at the boundary rather than reaching for `any` (e.g. the `Stored*` persistence shapes in `types.ts`,
  or page-local interfaces like the backlog/status shapes in `src/site/components/Admin.svelte`).
- **JSDoc.** Don't restate types in JSDoc (`@param {type}`/`@returns {type}`) — tsc owns that.
  JSDoc is for prose on non-obvious behavior, `@deprecated`, and `@example`; skip it entirely when
  the name + types are self-evident.

> **Caveat vs. the generic "Svelte 5 SPA" template:** this repo is a **multi-page** Vite build, so a
> few one-size-fits-all conventions don't apply literally. The Vite config is the multi-page
> [`vite.config.mjs`](vite.config.mjs) (9 HTML entries + the [`vite-ssg.mjs`](scripts/vite-ssg.mjs) plugin),
> **not** a 4-line `vite.config.ts`. SPA routing lives in [`static/_redirects`](static/_redirects)
> (Vite's `publicDir` is `static/`, **there is no `public/`**) and rewrites `/app/` → `/app/app.html`
> — a `/* /index.html 200` catch-all would break the marketing pages and the demo/staging surfaces.
> The source layout is `src/{lib,app,site}` (see **Repo layout** below), not `src/{components,pages,
> state}`.

## Repo layout

> **Vite builds `src/` → `dist/` (ADR-001/A26; source-tree reorg A30); Pages serves `dist/`.** The
> Vite **root is `src/`** (everything bundled/served) and **`static/` is the `publicDir`** (copied
> verbatim to the `dist/` root — this retired `scripts/copy-static.mjs`). `functions/`, `scripts/`,
> and tooling stay at the **repo root**, unserved (`partials/` retired by A69). **URLs are preserved 1:1**: each HTML
> entry's path *relative to `src/`* maps to its URL (`src/index.html` → `/`, `src/app/app.html` →
> `/app/app.html`), and `static/` mirrors to the root (`static/data` → `/data`, `static/_headers` →
> `/_headers`, `static/assets/og-image.png` → `/assets/og-image.png`). Source paths are **decoupled**
> from URLs (guardrail **A18 retired** — superseded by A26 + A30). Renaming/moving a browser-served
> file still changes its URL and must be kept in lockstep across `static/_redirects`,
> `static/_headers`, `static/robots.txt`, `static/sitemap.xml` + page canonicals, the absolute
> `/app//assets//data/` refs, `vite.config` (`root`/`publicDir`/`outDir`/`rollupOptions.input` +
> the `ssg()` page list), and the `build-manifest`/`bump-version` path assumptions. See
> [the deploy contract](docs/architecture.md#repository-layout--the-deploy-contract).

```
/                       repo root — tooling + the deploy-pinned edge layer (UNSERVED)
/src/                   Vite root — everything bundled/served (A30)
  index.html            homepage: hero + features + use cases + platforms + pricing + FAQ  → /
  howto.html            "How To" wiki: getting-started + per-platform import guides
  roadmap.html          shipped vs. planned checklist
  changelog.html        "Blotterlog" — versioned release notes (reads /data/changelog.json)
  legal.html            disclaimers, terms, privacy summary
  admin.html            internal admin controls (Cloudflare Access–gated)  → /admin.html
  lib/                  PURE-LOGIC CORE (A29) — framework-agnostic, native TS (A61), node-tested
    core.ts             metrics (compute), formatting, cost model, ref-data loading, event bus, shared
                        pure helpers (sessionOf/isoWeek/niceTicks/axMoney/fmtDur/ratio/num)
    report.ts           pure performance-report builder (on-screen + markdown + email — A34)
    sampledata.ts       demo CSV sample data  ·  curveseries.ts  pure daily gross/net/take series
    demostore.ts        in-memory Store implementation for demo (never persists)
    adapters.ts         platform CSV adapters + format auto-detection + fills matcher
    store.ts            IndexedDB persistence (trades, journal, meta, trademeta) + Store.local seam
    entitlements.ts     storage-tier resolver (scaffold; INTENTIONALLY not loaded)
    format.ts           shared esc/platformLabel + version-badge IIFE (ex assets/util.js — A76)
    types.ts            shared TS interfaces (Trade/Fill/CostModel/Metrics/StoreLike/… — A61)
  app/                  the journal app — a Svelte 5 SPA (ADR-001; vanilla view layer removed in A33)
    app.html            Svelte mount, data-mode="app" (served at /app/ via _redirects rewrite)
    demo.html           Svelte mount, data-mode="demo" (in-memory DemoStore — never persists)
    staging.html        Svelte mount, data-mode="staging" (key-gated, isolated IndexedDB)
    main.ts             entry: side-effect format.ts + mount(App)  ·  App.svelte root
    components/         the 17 app components (<script lang="ts">)
    lib/                app-only glue (TS): modal.ts (a11y action), actions.ts (styleProps),
                        files.ts (readImage/downloadBlob — ex util.js, A76), flags.ts (APP_FLAGS — ex data.ts)
  site/                 MARKETING + INFO — Svelte SSG (A69; prerendered at build by scripts/vite-ssg.mjs, hydrated in place)
    components/         Home / Howto / Roadmap / Changelog / Legal / Admin .svelte (the page components)
    lib/                shared chrome: Nav.svelte, Footer.svelte, SiteShell.svelte (base/typography styles + globals)
    entries/            per-page client entries (hydrate the prerendered component) — *.ts
  assets/               bundled chrome: favicon.svg, banner.svg, why-*.svg (Vite fingerprints these)
  styles/               tokens.css (single source — colors + fonts; page CSS now lives in scoped component <style>, A69)
/static/                Vite publicDir → copied verbatim to dist/ root (A30; retired copy-static.mjs)
  _headers              Cloudflare Pages security headers (CSP + hardening)  → /_headers
  _redirects  robots.txt  sitemap.xml
  assets/og-image.png   referenced by an absolute https og:image URL  → /assets/og-image.png
  data/                 reference data, fetched at runtime (each carries schemaVersion)  → /data/*
    brokers.json        broker commission tiers
    exchange-fees.json  CME exchange/clearing/NFA fees + micro set
    feeds.json          per-broker market-data feed options
    state-tax.json      Section 1256 model + per-state top rates
    manifest.json       content hashes for cache-busting (GENERATED — build-manifest.mjs)
    versions.json       two-track prod/staging versions (GENERATED by CI — don't hand-edit)
    backlog.json        engineering backlog (rendered read-only in admin.html)
    backlog_archive.json  done-item archive (doneNote record)
    changelog.json      curated, version-keyed release notes (hand-maintained)
/functions/             Cloudflare Pages Functions — TypeScript (A78) — PINNED at repo root — see functions/README.md
  _middleware.ts        key-gates /app/staging.html
  api/{geo,status,config,admin-key}.ts  geo · status · feature flags · admin token
  api/{me,checkout,webhook}.ts   Stripe/accounts scaffold
/scripts/
  build-manifest.mjs    regenerates static/data/manifest.json content hashes
  bump-version.mjs      two-track version bump from a merge commit (run by CI; classifies src/ + static/ paths)
  vite-ssg.mjs          A69 SSG plugin — server-renders the site components into their templates at build time (A95: moved here from the repo root)
  check-bundle-size.mjs dev-only /app/-surface JS size budget — fails the build if the app bundle crosses its ceiling (A96)
  test-*.mjs            the CI test suite (adapters / auth / version / flags / tax / demostore)
/e2e/                   Playwright render/E2E specs (dev-only — R19 Tier A)
/dist/                  Vite build output (GITIGNORED) — the artifact Cloudflare Pages serves (A26)
vite.config.mjs         Vite multi-page build config (root:src, publicDir:static, 9 HTML entries → dist/)
.node-version           pins Node 22 for the Cloudflare Pages build
package.json            deps manifest — Vite + dev tooling (minimal/pinned/audited per A28)
eslint.config.mjs       ESLint flat config  ·  .prettierrc.json  Prettier  ·  tsconfig.json + tsconfig.svelte.json + tsconfig.functions.json  tsc + svelte-check  ·  playwright.config.mjs  e2e
svelte.config.js        vitePreprocess — enables <script lang="ts"> in components (A61)
LICENSE                 proprietary — all rights reserved
```

## Data flow

```
loadRefData()   manifest.json → brokers/exchange-fees/feeds/state-tax (cache-busted by hash)
CSV text
  → Adapters.detect()  sniff header → platform
  → Adapters.parse()   platform adapter → normalized trades (fills go through pairFills())
  → Store.addTrades / getAllTrades   delta-merge + persist (IndexedDB)
  → applyFilters()  active filter set → working trade list
  → compute()       trades → metrics (PnL, win rate, drawdown, curve, expectancy, …)
  → costModel()     metrics + setup inputs → commissions, subscriptions, tax, take-home
  → Svelte app      → reactive components render cards / curve / calendar / advanced / break-even
```

The compute pipeline (`adapters`/`compute`/`costModel`) is the **pure-logic core**, reused
verbatim (A29). The Svelte app drives it: reactive state lives in runes (`$state`/`$derived`)
inside the components, the active `Store` is provided via `context('bb:store')` (real IndexedDB
for app/staging, in-memory `DemoStore` for demo), and `PAGE_MODE`/`STAGING_PAGE` adapt per
surface. Boot: `loadRefData()` → `Store.init()` → `restoreSession()` (demo seeds in-memory;
staging seeds its DB first) → `mount()`.

The `core.ts` event bus survives the cutover: shared actions fire events (`app:ready`,
`data:loaded`, `data:imported`, `note:saved`, `trade:deleted`, `backup:created`, `data:erased`)
over an `EventTarget` for any listener. The bus is a no-op with no subscriber.

## Adding things

- **A platform adapter:** one object in `src/lib/adapters.ts` (`sniff` + `toTrades`)
  plus a fixture in `scripts/test-adapters.mjs`. Every adapter normalizes to the
  same trade shape `{ time, date, pnl, symbol, root, side[, qty, entryTime,
  exitTime, holdMs] }` so `compute()`/`costModel()` never change.
- **A rate change:** edit the relevant `data/*.json`, then run
  `build-manifest.mjs`. No app code changes.
- **A new feature:** add/extend a Svelte component in `src/app/`; it ships to all three
  surfaces at once (no promotion step since the A33 cutover). Gate per surface in the component
  (`PAGE_MODE`/`isDemo`/`STAGING_PAGE`) and keep demo non-mutating. See the checklist in
  [docs/architecture.md](docs/architecture.md#building-a-feature-all-surfaces-share-one-spa).

## Deployment

Cloudflare Pages: `npm run build` emits `dist/` (Vite) and Pages serves it; `/functions/*` are
edge functions automatically. Build command `npm run build`, output dir `dist` (ADR-001/A26).
