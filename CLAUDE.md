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

- **No runtime dependencies** *(hard)*. The shipped app loads no framework and no
  third-party/runtime libraries — keep the *shipped output* dependency-free. NOTE:
  "no build" is no longer an absolute rule — whether to add build-*time* tooling
  (bundler / linters / tests) is an open decision (backlog **R19**); see the
  design pillars in [`docs/architecture.md`](docs/architecture.md#design-pillars).
- **Must be served over http(s).** The app `fetch()`es `/data/*.json`, so opening
  files from disk breaks it. Use a static server.
- **App scripts share one global scope** and load in a fixed order (defined in
  [`partials/app-scripts.html`](partials/app-scripts.html)):
  `util → store → adapters → core → render → data → ui → export → datamanager →
  widgets → main`. The `core → … → main` tail is the concern-split of the former
  monolithic `app.js`; `util`/`store`/`adapters` are loaded first as foundations.
  `main.js` loads last and holds all event wiring + `boot()`, so everything it
  references is already defined. Don't reorder; don't assume module isolation.
  *(A20 plans to migrate this to native ES modules — explicit `import`/`export`,
  no global scope or fixed load order — with no build/deps added.)*
- **The committed HTML and data manifest are generated artifacts** that must stay
  in sync with their sources — CI fails if they drift (see Commands).

## Commands

```bash
# Serve locally (any static server works)
python3 -m http.server 8000      # → http://localhost:8000/app/app.html

# Tests (these are the CI suite — run before pushing)
node scripts/test-adapters.cjs   # platform CSV adapters
node scripts/test-auth.mjs       # admin-token + Stripe-webhook signature
node scripts/test-version.mjs    # version-bump logic
node scripts/test-flags.mjs      # feature-flag default drift (data.js vs config.js)

# Build steps (idempotent; commit their output)
node scripts/build-includes.mjs  # regenerate app/{app,demo,staging}.html + info-page nav/footer from partials/
node scripts/build-manifest.mjs  # regenerate data/manifest.json content hashes (cache-busting)
```

CI (`.github/workflows/ci.yml`) runs all four tests, then re-runs both build
scripts and **fails if the result differs from what's committed**. So:

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
  core.js               globals, DOM helpers, metrics, formatting, cost model, ref-data loading
  render.js             dashboard rendering (cards, curve, calendar, advanced, break-even) + scope/filter
  data.js               CSV import, demo data, filters, day-notes journal, session restore, setup
  ui.js                 collapsible/drag panels + download / setup-label helpers
  export.js             condensed performance report (print → PDF)
  datamanager.js        Manage-data modal + per-trade editor + backup/restore
  widgets.js            activity terminal, session pill, workspace templates, stat-card modals
  main.js               DOM event wiring + boot() — LOADED LAST
  adapters.js           platform CSV adapters + format auto-detection + fills matcher
  store.js              IndexedDB persistence (trades, journal, meta, trademeta)
  entitlements.js       storage-tier resolver (scaffold; not currently loaded)
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
  test-*.{cjs,mjs}      the CI test suite (adapters / auth / version / flags)
/assets/                banner.svg, favicon.svg, page scripts (changelog.js, util.js, …)
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
  plus a fixture in `scripts/test-adapters.cjs`. Every adapter normalizes to the
  same trade shape `{ time, date, pnl, symbol, root, side[, qty, entryTime,
  exitTime, holdMs] }` so `compute()`/`costModel()` never change.
- **A rate change:** edit the relevant `data/*.json`, then run
  `build-manifest.mjs`. No app code changes.
- **Promoting a staging feature to prod + demo:** follow the checklist in
  [docs/architecture.md](docs/architecture.md#promoting-a-feature-staging--prod).

## Deployment

Cloudflare Pages, static files; `/functions/*` are edge functions automatically.
Recommended Pages build command: `node scripts/build-manifest.mjs`.
