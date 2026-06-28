# Blotterbook — architecture & contributing

The long-form "how and why" for Blotterbook's internals. Start with
[`README.md`](../README.md) for the product, and [`CLAUDE.md`](../CLAUDE.md) for
the quick operational reference (commands, conventions, file map). This document
is the deep-dive that `CLAUDE.md` points at.

The internal shorthand you'll see throughout the codebase and backlog (A2, CH12,
CH16, F13, F14, S19, R1, …) are backlog item ids from
[`data/backlog.json`](../data/backlog.json) — kept here for traceability.

## Contents

- [Design pillars](#design-pillars)
- [Repository layout & the deploy contract](#repository-layout--the-deploy-contract)
- [Architecture & data flow](#architecture--data-flow)
- [Shared chrome: tokens + partials](#shared-chrome-tokens--partials)
- [Input: the CSV](#input-the-csv)
- [Platform adapters & auto-detection](#platform-adapters--auto-detection)
- [Cost model](#cost-model)
- [Reference data (JSON) + cache-busting](#reference-data-json--cache-busting)
- [Local persistence](#local-persistence)
- [Staging sandbox](#staging-sandbox)
- [Building a feature (all surfaces share one SPA)](#building-a-feature-all-surfaces-share-one-spa)
- [Versioning & releases (CH12)](#versioning--releases-ch12)
- [Changelog release notes](#changelog-release-notes)
- [Admin page & the Live indicator](#admin-page--the-live-indicator)
- [Marketing & info site](#marketing--info-site)
- [Known limitations](#known-limitations)

## Design pillars

> **Re-ranked 2026-06-27 (ADR-001).** As Blotterbook moves from a personal tool to a
> commercial futures-analytics product, the one *product* pillar (local compute) is affirmed
> as HARD, while the two *implementation* pillars (no runtime deps, no build step) relax to
> enable the complex-UI roadmap. A **Vite build + Svelte SPA** on the `/app/` surface is now
> adopted — see [adr-001-vite-svelte-spa.md](adr-001-vite-svelte-spa.md), which supersedes the
> Tier B deferral in [build-step-decision.md](build-step-decision.md).

1. **Compute happens locally** *(HARD — the product moat)* — all parsing, metrics, and storage
   are client-side; **no trade data ever leaves the browser.** No telemetry, no analytics, no
   trade-data egress, regardless of what dependencies are added. This survives
   commercialization intact (the paid sync tier stays zero-knowledge / E2E-encrypted) and it
   gates every dependency (A28).
2. **Minimal, pinned, audited dependencies** *(policy — relaxed from "no runtime
   dependencies")* — dependencies are allowed where they earn their weight (the framework,
   charting, layout/virtualization libs); small utilities stay hand-written. The supply chain
   is treated as a security control: pinned versions + committed lockfile, `npm audit` in CI,
   SRI / strict CSP on shipped bundles. See guardrail **A28**. (Dev-only tooling — ESLint,
   Prettier, Playwright — was already adopted in R19 Tier A.)
3. **Deployable to Cloudflare Pages** *(build step now adopted)* — ships to Pages, with
   `/functions/*` as the thin edge layer for the few things that can't be client-side. A
   shipped-output build (Vite: bundler/minify/hashed names/strict CSP) was adopted via a build
   *output* dir, `dist/` (**A26**), reversing the old "committed files are the artifacts"
   contract (**A18**) — done all-at-once while there are no users. The pure-logic core is
   migrated **verbatim** (guardrail **A29**).

Because the app is split across files (it used to be one `index.html`), it must
be **served over http(s)** — opening from disk blocks the `fetch()` of the
reference data.

## Repository layout & the deploy contract

> **Updated by ADR-001 / A26.** There is now a Vite build: `npm run build` bundles the site into
> **`dist/`**, and Cloudflare Pages serves `dist/` (build command `npm run build`, output dir
> `dist`). **URLs are preserved 1:1** — source files were not moved, so a file's source path still
> mirrors its public URL, and the coupled-path table below still holds for any *future* move. What
> changed is only the deploy mechanism: Pages builds + serves an output dir instead of serving the
> committed tree as-is. The pre-Vite text below is kept because the couplings it documents remain
> accurate.

**The repo root is the *source* root, and (preserving URLs) a file's path still maps to its public
URL.** Vite fingerprints the JS/CSS it bundles and rewrites the HTML references; the verbatim-static
set (`data/*.json`, `_headers`, `_redirects`, `robots.txt`, `sitemap.xml`, `assets/og-image.png`) is
copied into `dist/` by `scripts/copy-static.mjs`. `functions/`, `scripts/`, `partials/`, and tooling
stay at the root, unserved. The folder layout still doubles as the **URL structure** and the
**deploy contract**; the root is deliberately flat (no `src/`+`public/` source reorg — A26 reversed
the contract via a build *output* dir, `dist/`, not by moving sources).

**Pinned at the deploy root** (Cloudflare Pages requires it — these cannot move):

- `functions/` — Pages Functions are resolved from the project root.
- `_headers`, `_redirects` — must sit at the output root to take effect.
- `robots.txt`, `sitemap.xml`, the favicon, and the pages that serve at `/…`
  (`index.html`, `howto.html`, `roadmap.html`, `changelog.html`, `legal.html`,
  `admin.html`).

**Consequence — moving any browser-served file changes its URL, and the path is
hard-coded in ~6 places that must be updated in lockstep.** Before relocating
anything under `app/`, `assets/`, or `data/` (or renaming a root page), update
*all* of:

| Coupling point | What it hard-codes |
| --- | --- |
| Absolute URL references in HTML/JS | `~23` `/app/…`, `~19` `/assets/…`, plus `/data/*.json` and `/api/*` `fetch()`es |
| `_redirects` | `/app/ → /app/app.html` rewrite |
| `_headers` | CSP `connect-src 'self'` assumes same-origin `/api`, `/data`, `/app` |
| `robots.txt` / `sitemap.xml` | `/app/`, `/admin.html`, and the public-page canonical URLs (CH5/CH6) |
| Page `<link rel="canonical">` + OG tags | the canonical URL of each marketing page (CH5) |
| `scripts/build-includes.mjs` | scans `['.', 'app']` for `*.html`; reads `partials/` |
| `scripts/build-manifest.mjs` | hashes `data/*.json`, with an explicit filename exclude-set |
| `scripts/bump-version.mjs` | classifies prod-shipping surfaces by the `app/`, `partials/`, `assets/`, `data/` prefixes + specific filenames |

**A build step now exists** (Vite → `dist/`, adopted in ADR-001/A26 — the old "no build
step" pillar was relaxed), but the **source layout stays flat**: do not reorganize into
`src/`+`public/`. A26 reversed the deploy contract via a build *output* dir (`dist/`), not by
moving sources — the repo root remains the source root and the canonical URL map, so the
coupled-path table above still governs any future move. `dist/` is gitignored; CI's drift gate
proves the build-time tooling didn't leave committed sources stale. (Tracked as guardrail
**A18**, realized by A26.)

## Architecture & data flow

The data flow is linear and entirely client-side:

```
loadRefData()   manifest.json → brokers/exchange-fees/feeds/state-tax (cache-busted by hash)
CSV text
  → Adapters.detect()  sniff header → platform
  → Adapters.parse()   platform adapter → normalized trades (fills go through pairFills())
                       → [{time,date,pnl,symbol,root,side[,qty,entry/exit,holdMs]}]
  → Store.addTrades / getAllTrades   delta-merge + persist (IndexedDB)
  → applyFilters()  active filter set → working trade list
  → compute()       trades → metrics (PnL, win rate, drawdown, curve, days, expectancy, …)
  → costModel()     metrics + Setup inputs → commissions, subscriptions, tax, take-home
  → Svelte app      → reactive components render cards / curve / calendar / advanced / break-even
```

**The app surface (A33 cutover).** All three surfaces — `app.html`, `demo.html`,
`staging.html` — are hand-authored Svelte 5 mount points that load the same SPA from
`app/staging-svelte/main.js`, adapting via `document.body.dataset.mode` (`PAGE_MODE`).
**App** (`data-mode="app"`) uses the real IndexedDB `Store`; **Demo** (`data-mode="demo"`)
uses the in-memory `DemoStore` and never persists; **Staging** (`data-mode="staging"`)
uses an isolated IndexedDB and seeds the sample dataset. The store is chosen by `PAGE_MODE`
and handed to the app via a `context('bb:store')` seam (A4/A31), so the UI is
source-agnostic and the demo's no-persist invariant holds by construction.

The **pure-logic core is reused verbatim** (A29) — `core.js` (compute + costModel + the
event bus), `adapters.js`, `store.js` / `demostore.js`, `curveseries.js`, `report.js`,
`sampledata.js`, and `assets/util.js` are plain ES modules imported unchanged by the Svelte
components. Reactive state lives in Svelte runes (`$state`/`$derived`) inside the components,
not in a shared globals object. Boot runs `loadRefData()` → `Store.init()` → `restoreSession()`
(demo seeds in-memory; staging seeds its DB first), then `mount()`s the app.

> *History:* the original app was a monolithic `app.js`, split (A2) into concern-scoped scripts
> and then (A20) migrated to native ES modules with reassignable state on `app/state.js`. The
> **A33 cutover deleted that vanilla view layer** (`render`/`ui`/`export`/`datamanager`/`widgets`/
> `main`/`state` and the `partials/app-*.html` fragments) in favor of the Svelte SPA — see
> [ADR-001](adr-001-vite-svelte-spa.md). Only the pure-logic core survived, unchanged.

The activity terminal, session pill, and workspace templates are now Svelte components under
`app/staging-svelte/components/`. The `core.js` event bus remains: shared actions fire events
(`app:ready`, `data:loaded`, `data:imported`, `note:saved`, `trade:deleted`, `backup:created`,
`data:erased`) over an `EventTarget` for any listener; it stays a no-op when nothing subscribes.

## Shared chrome: tokens + partials

To kill copy-paste drift across the info site, two things are single-sourced:

- **Design tokens** live only in [`tokens.css`](../tokens.css). `site.css`
  `@import`s it, the app surfaces and the bespoke homepage link it directly, and the
  Svelte components read its CSS custom properties. Change a color or font in one place.
- **Shared HTML lives in `partials/`** and
  [`scripts/build-includes.mjs`](../scripts/build-includes.mjs) injects the
  **info-site nav + footer**
  ([`partials/nav.html`](../partials/nav.html) /
  [`partials/footer.html`](../partials/footer.html)) into each info page via
  `<!-- include:nav active=… -->` / `<!-- include:footer -->` markers
  (`active=KEY` highlights the matching `data-nav` link). This is the **only**
  partial family left — the per-surface `partials/app-*.html` fragments were
  deleted in the A33 cutover. The three app surfaces (`app/{app,demo,staging}.html`)
  are now hand-authored Svelte mount points with no include markers; they differ
  only by `<body data-mode="…">`, and all mode-gating (a control `disabled` on
  demo, a staging-only affordance) lives in the Svelte app.

It's **idempotent** — re-run it after editing `nav.html`/`footer.html`:
`node scripts/build-includes.mjs`. The committed info-page HTML already contains the
rendered output, so the deploy works with or without running it. The **homepage,
admin, and the app surfaces keep their own HTML** by design — the info pages share
nav/footer; every surface shares the tokens.

## Input: the CSV

Blotterbook reads CSV exports from a trading **platform** and **auto-detects** the
format. The flow is two-step so a bad file never silently corrupts your data:

1. **Load CSV** → the file is parsed and the platform is detected (overridable
   from the **Platform** dropdown). A status line confirms what was found (e.g.
   *Detected TradingView · 63 trades ready*) or explains the problem.
2. **Start Blotterbook** (landing) or **Import** (Manage data) commits the parsed
   trades.

Only `.csv` files are accepted, and nothing loads until a parse succeeds.

The reference format is the **TradingView** "List of trades" export — required
columns (matched case-insensitively by substring): **`Time`**, **`Realized PnL
(value)`** (falls back to `Realized PnL`), and **`Action`**. Each row is one trade
— a position-*close* event with its own realized PnL; the instrument comes from
the `Action` text and reduces to a **root ticker** (`MESM2025` → `MES`,
`MES1!` → `MES`, `M2KZ2025` → `M2K`).

```
Time,Action,Realized PnL (value)
2026-06-02 10:00:00,"Close long position for symbol MESM2025 at price 5300.00",75.00
```

**Re-uploads merge.** Each trade gets a stable id from its
`time + symbol + side + pnl`. Uploading a CSV that overlaps a previous one only
inserts the genuinely new rows, so you can export a wider window each time without
creating duplicates. The data summary shows `+N new · M dup`.

## Platform adapters & auto-detection

Parsing is keyed to the trading **platform** the CSV came from (TradingView,
Tradovate, …) — **not** the broker. The two are independent: you might clear
through **AMP** but export from **TradingView**. The Broker dropdown only drives
the cost model; the Platform dropdown (and the detector) drives parsing.
`app/adapters.js` is a small registry — `window.Adapters` — with:

- **`detect(text)`** — sniffs the header row against each adapter's signature
  columns and returns the best match (e.g. Tradovate has `B/S` + `Contract`;
  Rithmic has `Buy/Sell` + `Qty Filled`; IBKR has `DateTime` + `Buy/Sell` +
  `Proceeds`). No match → the user picks the platform manually.
- **`parse(text, platformId?)`** — runs the chosen (or detected) adapter and
  returns `{ ok, trades, platform, label, beta, … }` or `{ ok:false, error }`.

Every adapter **normalizes to the same internal trade shape** — `{ time, date,
pnl, symbol, root, side[, qty, entryTime, exitTime, holdMs] }` — so `compute()` /
`costModel()` never change. Two export styles are handled:

- **Closed positions** — each row is a finished trade with realized PnL
  (**TradingView**, **MotiveWave**).
- **Fills** — individual buy/sell executions. A FIFO **round-trip matcher**
  (`pairFills()`) pairs entries→exits per symbol to build closed trades — and that
  finally unlocks **hold time** (*Avg Hold Time* in Advanced Statistics). When a
  fills export carries realized PnL per closing row (IBKR), it's used directly;
  otherwise PnL is computed from price × a built-in futures **point-value** map
  (unknown roots default to ×1, correct for equities).

Supported platforms: **TradingView** (verified), plus **Tradovate, Rithmic
R\|Trader, Sierra Chart, TradeStation, MotiveWave, Webull, Interactive Brokers,
Schwab/thinkorswim** — these are `beta`, built from documented formats and
exercised by `scripts/test-adapters.mjs` with synthetic samples. They're flagged
*(beta — verify the numbers)* in the UI until validated against a real export.
**Adding a platform** = one object in `adapters.js` (`sniff` + `toTrades`) and a
fixture in the test.

## Cost model

Costs are applied to whatever scope **and filters** are active.

**Commissions (per symbol, broker-aware):**

```
all-in per side = broker commission (micro|standard tier) + CME exchange/clearing/NFA fee
round-turn per trade = 2 × all-in per side          (one entry + one exit, 1 contract)
```

The broker commission comes from `brokers.json`; the exchange fee from
`exchange-fees.json`. A symbol's tier (micro vs. standard) is from that file's
`micro` list, falling back to a heuristic (`M`-prefixed roots are treated as
micros). Unknown symbols use a fallback and are flagged `*`.

**Subscriptions (not prorated):** `platform fee + data-feed fee` is charged as a
**full month for every distinct calendar month** present in the active scope —
never prorated by day.

**Tax (Section 1256, estimated):**

```
blended rate = ltcgWeight × ltcg + ordinaryWeight × fedOrdinary + state top marginal rate
            = 0.60 × 15%  + 0.40 × 24% + state rate            (defaults, from state-tax.json)
```

Applied to net pre-tax profit **only when positive**. A rough planning estimate,
not tax advice.

**Break-even per trade:** `(total commissions + subscriptions) ÷ trade count`.

## Reference data (JSON) + cache-busting

The broker/fee/feed/state tables live in `/data/*.json` and are fetched at runtime
by `loadRefData()` before anything renders. Edit a JSON file to change rates — no
app code changes. Brokers modeled: **AMP, EdgeClear, Tradovate / NinjaTrader,
Optimus, Charles Schwab (thinkorswim), Interactive Brokers, TradeStation,
TradingView PaperTrade** (zero commission).

| File | Contents |
| --- | --- |
| `brokers.json` | `order` + `brokers` (per-side commission for `micro`/`std`). |
| `exchange-fees.json` | `exchange` (fee per root), `micro` set, and a `fallback`. |
| `feeds.json` | `shared` feed sets + `brokerFeeds` (a broker may alias a shared set by name, e.g. `"AMP": "CQG"`). |
| `state-tax.json` | `model` (`fedOrdinary`, `ltcg`, weights) + `states` (`[abbr, ratePct, label]`). |

### `schemaVersion` + content-hash cache-busting

Every data file carries a **`schemaVersion`** field, and
`scripts/build-manifest.mjs` writes `data/manifest.json` mapping each file to a
short SHA-256 **content hash**. At boot the app fetches `manifest.json` with
`no-cache`, then requests each data file as `brokers.json?v=<hash>`.

- **Aggressive caching with instant updates.** Because the URL only changes when
  the file's bytes change, the data files can be cached forever by the browser and
  Cloudflare's edge — yet an edit takes effect immediately (new bytes → new hash →
  new URL → cache miss).
- **`schemaVersion` is the contract.** The hash answers *"did these bytes
  change?"*; the version answers *"did the **shape** change?"*. If a file's
  structure changes incompatibly, bump its `schemaVersion` so the app can detect a
  too-new/too-old file and refuse to misread it.

**After editing any data file, run:** `node scripts/build-manifest.mjs`.

## Local persistence

Trade data and day-notes are stored in **IndexedDB** via `app/store.js`. Nothing
is uploaded.

- **Stores:** `trades` (keyed by the dedupe id), `journal` (per-day notes keyed by
  date — each a `{text, tags, shots}` annotation), `meta` (setup + saved filters),
  and `trademeta` (per-trade tags/note/screenshots, keyed by trade id; added in DB
  v2).
- **Delta merge:** `Store.addTrades()` skips ids already present, so re-imports
  only add new trades.
- **Demo data is never persisted** — it lives in memory only.
- **Erase all local data** (Manage data → Danger zone) calls `Store.purge()` to
  wipe all four stores after a confirm.

The app never touches `indexedDB` directly — it goes through the `Store`
interface. A future cloud backend implements the same interface, so adding cloud
sync won't touch the rest of the app. The manager added `deleteTrade`,
`getAllJournal`, `deleteJournal`, `getAllMeta`,
`getTradeMeta`/`saveTradeMeta`/`deleteTradeMeta`/`allTradeMeta`, `exportAll`, and
`importAll` to that interface.

Separate, unrelated version numbers are intentionally **not** touched by the
release automation: `store.js` `DB_VERSION` (IndexedDB schema), the backup-file
`version`, and `manifest.json` content hashes.

## Staging sandbox

`app/staging.html` (`body[data-mode="staging"]`) is a **clone of the main app**,
launched from the admin page (**Launch staging env**) to trial changes before they
reach the main app. It uses an **isolated IndexedDB** (`blotterbookStaging`, set in
`store.js`) so testing never touches real data, and **seeds the sample dataset
once** so it opens in the loaded state. It has the full top bar including **Manage
data** and the **Load CSV** landing; notes/tags/filters persist to its own DB.

**Staging is key-gated.** `functions/_middleware.ts` gates `/app/staging.html`: it
requires the `ADMIN_KEY` via an `x-admin-key` header or a `bb_staging` cookie (if
`ADMIN_KEY` isn't configured, staging stays open). Browsers can't set request
headers on a navigation, so the admin panel's **Launch staging env** button sets
the short-lived path-scoped `bb_staging` cookie before opening the page — the token
never travels in the URL (S19).

After CH16, `STAGING_PAGE` no longer gates dashboard *features* — those were all
promoted to every surface. It marks only the staging **environment**: the isolated
`blotterbookStaging` DB, the one-time sample seed, the "open on the initial state"
landing, and the **Exit staging** affordance. The widgets it once gated (activity
terminal, session pill, workspace templates) are now ordinary Svelte components under
`app/staging-svelte/components/`, rendered on every surface.

## Building a feature (all surfaces share one SPA)

Since the A33 cutover, all three surfaces (app + demo + staging) **mount the same Svelte SPA**
from `app/staging-svelte/main.js` — there is no longer a separate staging codebase to "promote"
from. A feature you add to the Svelte app appears on every surface at once; the surface a behavior
shows on is decided **in the component** by `PAGE_MODE` / `isDemo` / `STAGING_PAGE`, not by where
the code lives.

**The model in one breath.** The **demo mirrors prod 1:1**: every feature the main app has, the
demo has too — just with data-mutating controls **disabled** and persistence blocked (the
in-memory `DemoStore` + `isDemo` guards). Staging is the same app on an isolated DB; the only
staging-exclusive surface is `app/staging.html` itself (env chrome, key gate). The two version
tracks in `data/versions.json` are **independent counters** — any change to a shared core module
or a Svelte component bumps **both** (it ships to all surfaces).

**Checklist for a new feature:**

1. **Build it in `app/staging-svelte/`** — a component (or extend one), reusing the pure-logic
   core (`core.js`/`adapters.js`/`store.js`/…) verbatim. Read/write data only through the `Store`
   handed in via `context('bb:store')`, never `indexedDB` directly.
2. **Gate per surface in the component** — e.g. `{#if STAGING_PAGE}` for staging-env-only chrome.
   Most features need no gate; they ship everywhere.
3. **Preserve demo restrictions (never skip).** Every data-mutating control needs `disabled` when
   `isDemo` **and** must not reach a write path under demo — the `DemoStore` is in-memory, but keep
   the guard explicit. Confirm no new write persists under demo.
4. **Stage-gate ahead of prod, if needed,** with a runtime feature flag (`/api/config`), not a
   code branch — the codebase no longer forks by surface.
5. **Verify all three surfaces** with `npm run build` + `npm run test:e2e`. App: feature works and
   persists. Demo: visible, mutating controls greyed out, nothing saved. Staging: works on its
   isolated DB.
6. **Title the PR `feat:` (or `fix:`)** so CH12 bumps the right level — never hand-edit
   `data/versions.json`.
7. **Add a changelog entry** for the new prod version in `data/changelog.json`.

## Versioning & releases (CH12)

Versioning is **automated from commits + PR merges**; there's nothing to bump by
hand. Two tracks live in one source of truth, `data/versions.json`:

- **`prod`** — shared by the main app and demo (their header badges both show it).
- **`staging`** — the staging sandbox's own, faster-moving version.

The platform **phase** is *derived*, not stored: while the prod major is `0` the
label reads **Beta `<prod>`** (e.g. `Beta 0.12.0`); at `1.0.0`+ the "Beta" drops.

**How a bump happens.** On every push to `main`, the `Version bump` workflow
(`.github/workflows/version-bump.yml` → `scripts/bump-version.mjs`) reads the merge
commit:

1. **Level** from the conventional-commit type in the squash-merge title — `feat:`
   → minor, `fix:`/`chore:`/`refactor:`/etc → patch, `feat!:` or a `BREAKING
   CHANGE:` footer → major, untyped → patch. (See the `commitConvention` field in
   `data/backlog.json`.)
2. **Which track** from the changed paths — any **prod-shipping** file (the pure-logic
   core `app/*.js`, the Svelte SPA `app/staging-svelte/**` `.js`/`.svelte`,
   `app/app.html`/`demo.html`, `partials/*`, `assets/*`, `tokens.css`, `data/*`
   except versions/backlog json) bumps **both** prod and staging; **only** `app/staging.html`
   bumps staging alone; info pages + `site.css` bump prod alone; everything else (admin,
   README, `.github`, scripts, functions) bumps nothing.

It writes `data/versions.json` and commits it back to `main` as
`chore(release): … [skip ci]` (so it doesn't re-trigger itself). **Requires** the
GitHub Actions bot to be allowed to push to `main`; if the branch is protected the
job logs a warning instead of failing.

**Display is runtime-fetched.** Each page's `.ver` badge is populated at load from
`/data/versions.json` (`assets/util.js` on the info pages; the Svelte app fetches it on
boot), so there's no baked literal to keep in sync anymore. The admin panel surfaces the
same values **read-only**.

## Changelog release notes

`changelog.html` → `assets/changelog.js` renders **`data/changelog.json`** (F13): a
curated, version-keyed release-notes file for the **prod** (main + demo) track,
newest first. Each entry has a prod `version`, a `date`, a friendly
`title`/`summary`, and optional `highlights`. Everything before automated
versioning is rolled up into a single `beta: true` "Beta released" entry.

It is **manually curated** — add a new entry at the top of `releases` each time the
prod version bumps. This deliberately replaces the old raw-commit feed so the page
reads as release notes, not a git log. The file is hash-cache-busted by
`build-manifest` like other `data/*.json`; `assets/changelog.js` keeps a tiny
inline fallback for local dev / a failed fetch.

## Admin page & the Live indicator

`admin.html` is an internal control page. It can set the homepage's **Live** pill,
manage **feature flags** (consumed by the app at boot via `/api/config`), show the
**platform versions** read-only, show a read-only **Backlog** view (from
[`data/backlog.json`](../data/backlog.json) — titles/effort/status only, prompts
stay in the file), auto-fill its own admin key, and **launch the staging sandbox**.
The homepage pill reads `/api/status`: a fixed status (**Live** = green,
**Maintenance** = yellow, **Offline** = red) wins; otherwise (**Auto**) it pings
`/app/`. `GET /api/status` and `GET /api/config` are public; all writes are
admin-only.

**Backend setup:** bind a **KV namespace** as `STATUS_KV` to the Pages project, and
set an **`ADMIN_KEY`** secret. Detailed click-paths and the admin-auth model
(short-lived HMAC tokens, Cloudflare Access JWT verification) are in
[`functions/README.md`](../functions/README.md).

### Location-based tax state

`functions/api/geo.ts` returns the visitor's coarse region from Cloudflare's edge
metadata (`request.cf`), and the app calls `/api/geo` on the landing screen to
**pre-select the US state** for the tax estimate. No IP or third-party service,
nothing stored; it never overrides a chosen/saved state and silently does nothing
off-Cloudflare or outside the US.

## Marketing & info site

The site root (`index.html`) is a **single-page, scrollable marketing site**,
styled with the same dark palette and tokens as the app. A sticky header carries
anchor links plus links to the standalone info pages. On narrow screens the nav
links collapse behind a **hamburger menu** (a CSS-only checkbox toggle on every
page).

**Standalone info pages** (share `site.css`): `howto.html` (a How-To wiki with a
sticky sidebar — getting-started walkthrough + per-platform import guides),
`roadmap.html` (shipped-vs-planned checklist), `changelog.html` ("Blotterlog"
release notes), and `legal.html` (disclaimers, terms, privacy summary).

## Known limitations

- **Drawdown is realized only** — from the closed-trade curve; no open-position
  heat.
- **Hold time depends on the export** — fills-based imports get hold time from the
  round-trip matcher; closed-position exports like TradingView carry only the close
  timestamp.
- **Beta adapters need real-export validation** — the eight non-TradingView
  adapters are built from documented formats and synthetic tests. Header changes on
  a platform's side can break detection.
- **Fills PnL can approximate** — when a fills export has no realized PnL, it's
  computed from price × a built-in futures point-value map; unrecognized futures
  roots fall back to ×1 (correct for equities, wrong for an unlisted contract until
  added to the map).
- **Commissions are modeled** — raw PnL is gross; rates come from the editable JSON
  and may drift.
- **Calendar-day & session grouping** — both use the literal `Time` value, not the
  CME session day; RTH/ETH assumes the timestamp's clock time.
- **Sharpe is illustrative** — daily PnL, population std, not annualized.
- **Local storage is per-browser** — data is not synced across devices and is
  cleared if you clear site data. Use **Manage data → Download backup** for a
  portable JSON snapshot. (Cloud sync is the planned subscription tier.)
