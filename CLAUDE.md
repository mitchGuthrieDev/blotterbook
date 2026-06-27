# CLAUDE.md

Operational guide for working in this repo. Product overview is in
[`README.md`](README.md); the deep architecture / promotion / versioning
narrative is in [`docs/architecture.md`](docs/architecture.md); the
accounts/payments/admin backend is in
[`functions/README.md`](functions/README.md).

## What this is

**Blotterbook** is a dependency-free, client-side trading journal and cost
dashboard for futures traders. It parses a balance-history CSV (TradingView and
other platforms) entirely in the browser, stores it locally in IndexedDB, and
renders performance / calendar / cost / tax / stats views. **No trade data ever
leaves the browser.** It deploys to Cloudflare Pages as static files plus
`/functions/*` edge functions.

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
- **App scripts are native ES modules** (A20) — *(describes today's vanilla app; the
  Vite + Svelte migration of ADR-001 changes this for the `/app/` surface — see A26/A27)*.
  [`partials/app-scripts.html`](partials/app-scripts.html)
  is a single module entry, `<script type="module" src="main.js">`; `main.js`
  imports the rest. Each module `export`s what others use and `import`s what it
  needs — no shared global scope, no fixed load order, no module-isolation
  assumptions to break. The concern-split modules are
  `core / render / data / ui / export / datamanager / widgets`, with `store`/`adapters`
  as foundations and [`assets/util.js`](assets/util.js) shared by the app *and* the
  info pages. Reassignable cross-module state lives on the shared
  [`app/state.js`](app/state.js) object (`state.X`) — ESM import bindings are
  read-only, so a plain shared object is the seam for reassignable state; the const
  objects `FILTERS`/`curveSel` stay plain exports. Module scripts are deferred, so
  `boot()` (in `main.js`) still runs after the DOM is parsed; `widgets.js` is a
  side-effect import in `main.js` so its event-bus subscriptions register before
  `boot()` emits `app:ready`.
- **The committed HTML and data manifest are generated artifacts** that must stay
  in sync with their sources — CI fails if they drift (see Commands).

## Commands

```bash
# One-time: install pinned deps (Vite + dev tooling) from the lockfile
npm ci

# Build the deploy artifact (ADR-001/A26). Emits dist/ = what Cloudflare Pages serves.
npm run build                    # build-includes + build-manifest + vite build + copy-static → dist/
npm run dev                      # Vite dev server (HMR) for local development
npm run preview                  # serve the built dist/ locally (production-like)

# Tests / lint (the CI suite — run before pushing)
npm test                         # = lint + typecheck + format:check + test:unit
npm run test:unit                # the 5 node suites: adapters / auth / version / flags / tax
npm run lint                     # ESLint (flat config)
npm run typecheck                # tsc --checkJs over the JSDoc-typed modules (CH33; opt-in via // @ts-check)
npm run test:e2e                 # Playwright render tests — BUILDS then serves dist/, boots every surface
npm run format                   # Prettier
# (the node suites still run standalone too, e.g. `node scripts/test-adapters.mjs`)

# Build sub-steps (idempotent; commit their output — they write COMMITTED sources, not dist/)
node scripts/build-includes.mjs  # regenerate app/{app,demo,staging}.html + info-page nav/footer from partials/
node scripts/build-manifest.mjs  # regenerate data/manifest.json content hashes (cache-busting)
# scripts/copy-static.mjs runs as part of `npm run build` (copies verbatim files into dist/)
```

> **Deploy artifact = `dist/` (gitignored), built by Vite (ADR-001/A26).** The repo root is no
> longer the web root — Cloudflare Pages runs `npm run build` and serves `dist/`. URLs are preserved
> 1:1, source files were not moved, and `functions/`/`scripts/`/`partials/` stay at the root
> (unserved). Pages dashboard settings (build command `npm run build`, output dir `dist`, unset
> `SKIP_DEPENDENCY_INSTALL`) are recorded in [the ADR](docs/adr-001-vite-svelte-spa.md). The Svelte
> migration of the `/app/` surface is A27 (not yet started — the app is still vanilla ESM).

CI (`.github/workflows/ci.yml`) runs `npm ci` → lint → typecheck → format → the unit/logic
tests → **the Vite build** → the Playwright render tests (against `dist/`), then re-runs both
include/manifest build scripts and **fails if the result differs from what's committed** (the drift
gate; `dist/` is gitignored, so this proves the build-time tooling didn't leave committed sources
stale). So:

- **After editing any `partials/*` →** run `build-includes.mjs` and commit the
  regenerated `app/*.html` / info pages.
- **After editing any `data/*.json` →** run `build-manifest.mjs` and commit the
  regenerated `data/manifest.json`.

## Conventions

- **Never hand-edit `data/versions.json`.** Versioning is automated from commit
  type + changed paths on push to `main` (CH12). See
  [docs/architecture.md](docs/architecture.md#versioning--releases-ch12). Don't
  set `prod` to the staging number.
- **PR titles are conventional commits** and drive the version bump: `feat:` →
  minor, `fix:`/`chore:`/`refactor:` → patch, `feat!:` / `BREAKING CHANGE:` →
  major.
- **App surfaces & their sources.** `app/app.html` + `app/demo.html` are still vanilla,
  generated from `partials/app-*.html` via `<!--IF mode=app|demo-->` conditionals — edit the
  partial, not the generated HTML. **`app/staging.html` is now the Svelte 5 app** (ADR-001/A27):
  a hand-authored mount point with no include markers (build-includes skips it); its UI lives in
  `app/staging-svelte/*.svelte` and reuses the pure-logic core verbatim (A29). Don't add staging
  markup to the partials anymore — staging diverges until prod/demo also migrate (Phase 4).
- **Demo must never mutate or persist.** Any data-writing control needs `disabled`
  in its `<!--IF mode=demo-->` variant **and** a `DEMO_MODE` guard on the write
  path. When adding a write, confirm it can't run under `DEMO_MODE`.
- **Design tokens live only in `tokens.css`** — `site.css` and `app/app.css`
  `@import` it; the homepage links it. Don't duplicate colors/fonts.
- **Edit data through the `Store` interface only** (`app/store.js`) — never touch
  `indexedDB` directly. A future `CloudStore` implements the same interface.
- **The user-facing changelog is hand-curated** in `data/changelog.json` (not raw
  commits). Add an entry when `prod` bumps.

## Repo layout

> **Vite builds the repo to `dist/` (ADR-001/A26); Pages serves `dist/`.** Source files stay at
> the repo root (they were NOT moved) but the root is no longer the served web root — `npm run build`
> emits `dist/` and that is what deploys. **URLs are preserved 1:1** with the old layout, so a file's
> source path still mirrors its public URL. Vite fingerprints the JS/CSS it bundles; the
> verbatim-static set (`data/*.json`, `_headers`, `_redirects`, `robots.txt`, `sitemap.xml`,
> `assets/og-image.png`) is copied into `dist/` by `scripts/copy-static.mjs`. `functions/`,
> `scripts/`, `partials/`, and tooling stay at the root, unserved. Renaming/moving a browser-served
> file still changes its URL and must be kept in lockstep across `_redirects`, `_headers`,
> `robots.txt`, `sitemap.xml` + page canonicals, the absolute `/app//assets//data/` refs, the Vite
> `rollupOptions.input` list, and the `build-includes`/`build-manifest`/`bump-version`/`copy-static`
> path assumptions. See [the deploy contract](docs/architecture.md#repository-layout--the-deploy-contract)
> (guardrail A18, now realized by A26).

```
/                       marketing + info site (bespoke CSS in index.html; site.css for the rest)
  _headers              Cloudflare Pages security headers (CSP + hardening)
  tokens.css            design tokens (colors + fonts) — single source for every surface
  index.html            homepage: hero + features + use cases + platforms + pricing + FAQ
  howto.html            "How To" wiki: getting-started + per-platform import guides
  roadmap.html          shipped vs. planned checklist
  changelog.html        "Blotterlog" — versioned release notes (reads data/changelog.json)
  legal.html            disclaimers, terms, privacy summary
  admin.html            internal admin controls (Cloudflare Access–gated)
  site.css              shared styles for howto/roadmap/changelog/legal/admin (@imports tokens.css)
/partials/              shared HTML fragments injected at build time (single source)
  nav.html, footer.html the info-site nav + footer
  app-*.html            the per-surface app fragments (source for app/{app,demo,staging}.html)
/app/                   the journal app
  app.html              app markup (served at /app/ via _redirects rewrite)
  demo.html             demo on its own page (in-memory, never persists)
  staging.html          key-gated sandbox clone of the app (isolated IndexedDB)
  app.css               all app styles (shared by app/demo/staging)
  state.js              shared mutable cross-module app state (the `state.X` object — ESM seam)
  core.js               DOM helpers, metrics, formatting, cost model, ref-data loading, event bus
  render.js             dashboard rendering (cards, curve, calendar, advanced, break-even) + scope/filter
  data.js               CSV import, demo data, filters, day-notes journal, session restore, setup
  ui.js                 collapsible/drag panels + download / setup-label helpers
  export.js             condensed performance report (print → PDF)
  datamanager.js        Manage-data modal + per-trade editor + backup/restore
  widgets.js            activity terminal, session pill, workspace templates, stat-card modals
  main.js               DOM event wiring + boot() — the ES-module ENTRY (imports the rest)
  adapters.js           platform CSV adapters + format auto-detection + fills matcher
  store.js              IndexedDB persistence (trades, journal, meta, trademeta)
  entitlements.js       storage-tier resolver (scaffold; not currently loaded)
  types.js              shared JSDoc @typedefs (dev-only types; never loaded at runtime — CH33)
/data/                  reference data, fetched at runtime (each carries schemaVersion)
  brokers.json          broker commission tiers
  exchange-fees.json    CME exchange/clearing/NFA fees + micro set
  feeds.json            per-broker market-data feed options
  state-tax.json        Section 1256 model + per-state top rates
  manifest.json         content hashes for cache-busting (GENERATED)
  versions.json         two-track prod/staging versions (GENERATED by CI — don't hand-edit)
  backlog.json          engineering backlog (rendered read-only in admin.html)
  changelog.json        curated, version-keyed release notes (hand-maintained)
/functions/             Cloudflare Pages Functions — see functions/README.md
  _middleware.js        key-gates /app/staging.html
  api/geo.js            visitor region → pre-fill tax state
  api/status.js         homepage Live-indicator status (KV-backed)
  api/config.js         feature flags (KV)
  api/admin-key.js      returns ADMIN_KEY token to Access-authenticated admins
  api/{me,checkout,webhook}.js   Stripe/accounts scaffold
/scripts/
  build-includes.mjs    assembles info pages + the three app surfaces from partials/
  build-manifest.mjs    regenerates data/manifest.json content hashes
  copy-static.mjs       copies verbatim-static files (data/, _headers, _redirects, robots, sitemap, og-image) into dist/ (A26)
  bump-version.mjs      two-track version bump from a merge commit (run by CI)
  test-*.mjs            the CI test suite (adapters / auth / version / flags / tax)
/assets/                banner.svg, favicon.svg, page scripts (changelog.js, util.js, …)
/e2e/                   Playwright render/E2E specs (dev-only — R19 Tier A)
/dist/                  Vite build output (GITIGNORED) — the artifact Cloudflare Pages serves (A26)
vite.config.mjs         Vite multi-page build config (9 HTML entries → dist/) — ADR-001/A26
.node-version           pins Node 22 for the Cloudflare Pages build
package.json            deps manifest — Vite + dev tooling (minimal/pinned/audited per A28)
eslint.config.mjs       ESLint flat config  ·  .prettierrc.json  Prettier  ·  jsconfig.json  tsc --checkJs  ·  playwright.config.mjs  e2e
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
  → render*()       → cards / curve / calendar / advanced / break-even
```

Key globals: `TRADES`, `METRICS_ALL`, `FILTERS`, `SCOPE`, `calYear`/`calMonth`,
`selectedDate`, `JOURNAL_DATES`, `TRADE_META`, `SAVED_FILTERS`, `DEMO_MODE`,
`PAGE_MODE`/`STAGING_PAGE`. Boot order: `loadRefData()` → `Store.init()` →
`restoreSession()` (demo runs `runDemo()`; staging seeds its DB first).

Shared code never names a widget symbol directly — `core.js` exposes an event bus
(`emit`/`onEvent` over an `EventTarget`); shared actions fire events
(`app:ready`, `data:loaded`, `data:imported`, `note:saved`, `trade:deleted`,
`backup:created`, `data:erased`) that `widgets.js` subscribes to. The bus is a
no-op with no subscriber.

## Adding things

- **A platform adapter:** one object in `app/adapters.js` (`sniff` + `toTrades`)
  plus a fixture in `scripts/test-adapters.mjs`. Every adapter normalizes to the
  same trade shape `{ time, date, pnl, symbol, root, side[, qty, entryTime,
  exitTime, holdMs] }` so `compute()`/`costModel()` never change.
- **A rate change:** edit the relevant `data/*.json`, then run
  `build-manifest.mjs`. No app code changes.
- **Promoting a staging feature to prod + demo:** follow the checklist in
  [docs/architecture.md](docs/architecture.md#promoting-a-feature-staging--prod).

## Deployment

Cloudflare Pages, static files; `/functions/*` are edge functions automatically.
Recommended Pages build command: `node scripts/build-manifest.mjs`.
