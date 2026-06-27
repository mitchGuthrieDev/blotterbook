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
# Serve locally (any static server works)
python3 -m http.server 8000      # → http://localhost:8000/app/app.html

# Dev tooling (R19 Tier A — devDependencies only; NEVER ships). One-time:
npm ci                           # install pinned devDeps from package-lock.json

# Tests / lint (the CI suite — run before pushing)
npm test                         # = test:unit + lint
npm run test:unit                # the 5 node suites: adapters / auth / version / flags / tax
npm run lint                     # ESLint (flat config)
npm run typecheck                # tsc --checkJs over the JSDoc-typed modules (CH33; opt-in via // @ts-check)
npm run test:e2e                 # Playwright render tests (boots every surface; starts its own server)
npm run format                   # Prettier (NOT yet applied repo-wide — see CH32)
# (the node suites still run standalone too, e.g. `node scripts/test-adapters.mjs`)

# Build steps (idempotent; commit their output)
node scripts/build-includes.mjs  # regenerate app/{app,demo,staging}.html + info-page nav/footer from partials/
node scripts/build-manifest.mjs  # regenerate data/manifest.json content hashes (cache-busting)
```

CI (`.github/workflows/ci.yml`) runs `npm ci` → lint → typecheck → the unit/logic
tests → the Playwright render tests, then re-runs both build scripts and **fails if
the result differs from what's committed** (which also proves the dev tooling never wrote into
the shipped/committed files). So:

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
- **Three app surfaces, one source.** `app/{app,demo,staging}.html` are generated
  from `partials/app-*.html` via `<!--IF mode=app|demo|staging-->` conditionals.
  Edit the partial, not the generated HTML.
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

> **No build step → the repo root IS the Cloudflare Pages web root, so a file's
> path IS its public URL.** Moving any browser-served file changes its URL and
> must be updated in lockstep across `_redirects`, `_headers`, `robots.txt`,
> `sitemap.xml` + page canonicals, the absolute `/app//assets//data/`
> references, and the `build-includes`/`build-manifest`/`bump-version` path
> assumptions. `functions/`, `_headers`, and `_redirects` are pinned at the root
> by Pages. Don't reorganize into `src/`+`public/`. See
> [the deploy contract](docs/architecture.md#repository-layout--the-deploy-contract)
> (guardrail A18).

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
  bump-version.mjs      two-track version bump from a merge commit (run by CI)
  test-*.mjs            the CI test suite (adapters / auth / version / flags / tax)
/assets/                banner.svg, favicon.svg, page scripts (changelog.js, util.js, …)
/e2e/                   Playwright render/E2E specs (dev-only — R19 Tier A)
package.json            dev-only tooling manifest — devDependencies ONLY (the shipped app has none)
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
