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
  mount points (`<div id="app">` + `<script type="module" src="./staging-svelte/main.js">`, body
  `data-mode="app|demo|staging"`). The Svelte app lives in `app/staging-svelte/` (App.svelte +
  components/ + modal.js/util.js; dir rename is A30) and reuses the **pure-logic core verbatim**
  (A29): `adapters` / `compute`+`costModel` in `core.js` / `store` / `sampledata` / `demostore` /
  `curveseries` / `report`, with [`assets/util.js`](assets/util.js) shared by the app *and* the info
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

# Build the deploy artifact (ADR-001/A26). Emits dist/ = what Cloudflare Pages serves.
npm run build                    # build-includes + build-manifest + vite build + copy-static → dist/
npm run dev                      # Vite dev server (HMR) for local development
npm run preview                  # serve the built dist/ locally (production-like)

# Tests / lint (the CI suite — run before pushing)
npm test                         # = lint + typecheck + format:check + test:unit
npm run test:unit                # the 6 node suites: adapters / auth / version / flags / tax / demostore
npm run lint                     # ESLint (flat config)
npm run typecheck                # tsc --checkJs over the JSDoc-typed modules (CH33; opt-in via // @ts-check)
npm run test:e2e                 # Playwright render tests — BUILDS then serves dist/, boots every surface
npm run format                   # Prettier
# (the node suites still run standalone too, e.g. `node scripts/test-adapters.mjs`)

# Build sub-steps (idempotent; commit their output — they write COMMITTED sources, not dist/)
node scripts/build-includes.mjs  # inject the info-page nav/footer from partials/ (app surfaces are hand-authored Svelte mounts — untouched)
node scripts/build-manifest.mjs  # regenerate data/manifest.json content hashes (cache-busting)
# scripts/copy-static.mjs runs as part of `npm run build` (copies verbatim files into dist/)
```

> **Deploy artifact = `dist/` (gitignored), built by Vite (ADR-001/A26).** The repo root is no
> longer the web root — Cloudflare Pages runs `npm run build` and serves `dist/`. URLs are preserved
> 1:1, source files were not moved, and `functions/`/`scripts/`/`partials/` stay at the root
> (unserved). Pages dashboard settings (build command `npm run build`, output dir `dist`, unset
> `SKIP_DEPENDENCY_INSTALL`) are recorded in [the ADR](docs/adr-001-vite-svelte-spa.md). The Svelte
> migration is complete: A27 brought Svelte to staging, and the **A33 cutover** moved all three
> surfaces (app/demo/staging) to the Svelte SPA and deleted the vanilla view layer.

CI (`.github/workflows/ci.yml`) runs `npm ci` → lint → typecheck → format → the unit/logic
tests → **the Vite build** → the Playwright render tests (against `dist/`), then re-runs both
include/manifest build scripts and **fails if the result differs from what's committed** (the drift
gate; `dist/` is gitignored, so this proves the build-time tooling didn't leave committed sources
stale). So:

- **After editing `partials/nav.html` or `partials/footer.html` →** run `build-includes.mjs` and
  commit the regenerated info pages (changelog/roadmap/legal/howto). The app surfaces are
  hand-authored Svelte mounts — they carry no include markers and are not regenerated.
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
- **App surfaces & their sources (A33).** All three — `app/app.html`, `app/demo.html`,
  `app/staging.html` — are hand-authored, marker-free **Svelte mount points** that load
  `app/staging-svelte/main.js` and differ only by `<body data-mode="app|demo|staging">`. Edit the
  Svelte components in `app/staging-svelte/`, not the HTML shells. (The old `partials/app-*.html`
  single-source shells were deleted in A33.)
- **Demo must never mutate or persist.** Demo mounts the Svelte app with `data-mode="demo"` → the
  in-memory `DemoStore`, so **nothing reaches IndexedDB or localStorage by construction**. On top of
  that, every data-writing control is `disabled` when `PAGE_MODE === 'demo'` and each write path is
  guarded (`if (isDemo) return;`). When adding a write, confirm both. (e2e asserts no Blotterbook
  IndexedDB is created on demo.)
- **Design tokens live only in `tokens.css`** — `site.css` `@import`s it; the app surfaces and the
  homepage link it; Svelte components read the token CSS vars. Don't duplicate colors/fonts.
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
  home.css              homepage styles (extracted from index.html's inline <style> for CSP — A55)
  howto.html            "How To" wiki: getting-started + per-platform import guides
  roadmap.html          shipped vs. planned checklist
  changelog.html        "Blotterlog" — versioned release notes (reads data/changelog.json)
  legal.html            disclaimers, terms, privacy summary
  admin.html            internal admin controls (Cloudflare Access–gated)
  admin.css             admin-panel styles (extracted from admin.html's inline <style> for CSP — A55)
  site.css              shared styles for howto/roadmap/changelog/legal/admin (@imports tokens.css)
/partials/              shared HTML fragments injected at build time (single source)
  nav.html, footer.html the info-site nav + footer (the only partials left; app-*.html removed in A33)
/app/                   the journal app — a Svelte 5 SPA (ADR-001; vanilla view layer removed in A33)
  app.html              Svelte mount, data-mode="app" (served at /app/ via _redirects rewrite)
  demo.html             Svelte mount, data-mode="demo" (in-memory DemoStore — never persists)
  staging.html          Svelte mount, data-mode="staging" (key-gated, isolated IndexedDB)
  staging-svelte/       the Svelte app (dir rename is A30): main.js entry, App.svelte, components/,
                        modal.js (modal a11y action), util.js (readImage/downloadBlob)
  core.js               metrics (compute), formatting, cost model, ref-data loading, event bus, shared
                        pure helpers (sessionOf/isoWeek/niceTicks/axMoney/fmtDur/ratio/num)
  data.js               client APP_FLAGS feature-flag defaults (A14 drift-guarded; ex-view module — A33)
  report.js             pure performance-report builder (on-screen + markdown + email — A34)
  sampledata.js         demo CSV sample data  ·  curveseries.js  pure daily gross/net/take series
  demostore.js          in-memory Store implementation for demo (never persists)
  adapters.js           platform CSV adapters + format auto-detection + fills matcher
  store.js              IndexedDB persistence (trades, journal, meta, trademeta) + Store.local seam
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
  build-includes.mjs    injects the nav/footer partials into the info pages (app surfaces are hand-authored Svelte mounts — skipped)
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
  → Svelte app      → reactive components render cards / curve / calendar / advanced / break-even
```

The compute pipeline (`adapters`/`compute`/`costModel`) is the **pure-logic core**, reused
verbatim (A29). The Svelte app drives it: reactive state lives in runes (`$state`/`$derived`)
inside the components, the active `Store` is provided via `context('bb:store')` (real IndexedDB
for app/staging, in-memory `DemoStore` for demo), and `PAGE_MODE`/`STAGING_PAGE` adapt per
surface. Boot: `loadRefData()` → `Store.init()` → `restoreSession()` (demo seeds in-memory;
staging seeds its DB first) → `mount()`.

The `core.js` event bus survives the cutover: shared actions fire events (`app:ready`,
`data:loaded`, `data:imported`, `note:saved`, `trade:deleted`, `backup:created`, `data:erased`)
over an `EventTarget` for any listener. The bus is a no-op with no subscriber.

## Adding things

- **A platform adapter:** one object in `app/adapters.js` (`sniff` + `toTrades`)
  plus a fixture in `scripts/test-adapters.mjs`. Every adapter normalizes to the
  same trade shape `{ time, date, pnl, symbol, root, side[, qty, entryTime,
  exitTime, holdMs] }` so `compute()`/`costModel()` never change.
- **A rate change:** edit the relevant `data/*.json`, then run
  `build-manifest.mjs`. No app code changes.
- **A new feature:** add/extend a Svelte component in `app/staging-svelte/`; it ships to all three
  surfaces at once (no promotion step since the A33 cutover). Gate per surface in the component
  (`PAGE_MODE`/`isDemo`/`STAGING_PAGE`) and keep demo non-mutating. See the checklist in
  [docs/architecture.md](docs/architecture.md#building-a-feature-all-surfaces-share-one-spa).

## Deployment

Cloudflare Pages: `npm run build` emits `dist/` (Vite) and Pages serves it; `/functions/*` are
edge functions automatically. Build command `npm run build`, output dir `dist` (ADR-001/A26).
