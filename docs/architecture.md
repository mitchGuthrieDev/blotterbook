# Blotterbook — architecture & contributing

The long-form "how and why" for Blotterbook's internals. Start with
[`README.md`](../README.md) for the product, and [`CLAUDE.md`](../CLAUDE.md) for
the quick operational reference (commands, conventions, file map). This document
is the deep-dive that `CLAUDE.md` points at.

The internal shorthand you'll see throughout the codebase and backlog (A2, CH12,
CH16, F13, F14, S19, R1, …) are backlog item ids from
[`data/backlog.json`](../data/backlog.json) — kept here for traceability.

## Contents

- [Architecture diagrams](#architecture-diagrams)
- [Design pillars](#design-pillars)
- [Repository layout & the deploy contract](#repository-layout--the-deploy-contract)
- [Architecture & data flow](#architecture--data-flow)
- [Shared chrome: tokens + Svelte components](#shared-chrome-tokens--svelte-components)
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

## Architecture diagrams

Visual companions to this document live in
[`docs/architecture-diagrams/`](architecture-diagrams/) — Mermaid-in-Markdown diagrams (GitHub renders
them inline) covering the [boot sequence](architecture-diagrams/boot-and-lifecycle.md),
[app shell & routing](architecture-diagrams/app-shell-and-routing.md),
[storage & mode separation](architecture-diagrams/storage-and-mode-separation.md),
the [CSV → adapters](architecture-diagrams/csv-import-adapters.md) and
[compute → cost model → render](architecture-diagrams/compute-costmodel-render.md) pipelines,
the [core reuse map](architecture-diagrams/core-reuse-map.md),
the [edge functions](architecture-diagrams/cloudflare-functions.md),
the [build/deploy](architecture-diagrams/build-and-deploy.md) +
[repo-layout URL contract](architecture-diagrams/repo-layout-url-contract.md),
[CI](architecture-diagrams/ci-pipeline.md), [versioning](architecture-diagrams/versioning-two-track.md),
and the [security trust boundaries](architecture-diagrams/security-trust-boundaries.md). They're kept
in sync with the code — start there for a big-picture view, then read the prose below for the detail.

## Design pillars

> **Updated 2026-06-30.** The original "pillars" — the local-compute-only / no-trade-data-egress
> moat, the "minimal/pinned/audited dependencies" posture, and (after ADR-002) "`tokens.css` is the
> single token source" — have been **retired** by the decision owner. Blotterbook is now a
> conventional modern **Svelte 5 (runes) + Tailwind v4 + shadcn-svelte** app: pull in dependencies
> that earn their weight and use the standard tooling. See
> [adr-001-vite-svelte-spa.md](adr-001-vite-svelte-spa.md) (Vite + Svelte SPA) and
> [adr-002-tailwind-shadcn.md](adr-002-tailwind-shadcn.md) (the Tailwind + shadcn-svelte re-platform).

What remains are practical invariants, not moats:

1. **Client-side by construction** — parsing, metrics, and IndexedDB storage all run in the browser
   today. This is how the app is *built*, not a hard egress ban; a future cloud-sync tier is on the
   roadmap.
2. **Standard, pinned dependency tree** — Vite + Svelte 5 + Tailwind v4 + shadcn-svelte/bits-ui plus
   dev tooling (ESLint, Prettier, Playwright). Versions are pinned and the lockfile is committed.
3. **Deployable to Cloudflare Pages** — ships to Pages, with `/functions/*` as the thin edge layer
   for the few things that can't be client-side. The Vite build emits `dist/` (**A26**), reversing
   the old "committed files are the artifacts" contract (**A18**). The pure-logic core is reused
   as-is (guardrail **A29**).

Because the app is split across files (it used to be one `index.html`), it must
be **served over http(s)** — opening from disk blocks the `fetch()` of the
reference data.

## Repository layout & the deploy contract

> **Updated by ADR-001 / A26, then the A30 source-tree reorg.** There is a Vite build: `npm run
> build` bundles the site into **`dist/`**, and Cloudflare Pages serves `dist/` (build command `npm
> run build`, output dir `dist`). **A30 moved the source into a Vite/Svelte-shaped tree** — `src/`
> (the Vite `root`, everything bundled/served) + `static/` (Vite's `publicDir`, copied verbatim) —
> with `functions/` and tooling pinned at the repo root. **URLs are preserved 1:1**: each HTML
> entry's path *relative to `src/`* is mirrored into `dist/` (`src/index.html` → `/`,
> `src/app/app.html` → `/app/app.html`), and `static/` is copied to the `dist/` root
> (`static/data` → `/data`, `static/_headers` → `/_headers`, `static/assets/og-image.png` →
> `/assets/og-image.png`). Source paths are now **decoupled** from URLs.

**Guardrail A18 is RETIRED (superseded by A26 + A30).** A18 banned a `src/`+`public/` reorg on the
grounds that "repo root = web root = deploy contract." A26 dissolved that by introducing a build
*output* dir (`dist/`), and A30 then executed the reorg: a file's source path no longer mirrors its
URL — Vite's `root` + per-entry input mapping + `publicDir` reproduce today's URLs exactly. The one
remaining hard constraint is that **`functions/` stays pinned at the repo root** (Pages resolves it
from there). See [`docs/archive/structure-reorg-plan.md`](archive/structure-reorg-plan.md) for the executed layout.

**The source tree (`src/` + `static/`).** Vite fingerprints the JS/CSS it bundles (output under
`/assets/…`) and rewrites the HTML references; the verbatim-static set (`static/data/*.json`,
`static/_headers`, `static/_redirects`, `static/robots.txt`, `static/sitemap.xml`,
`static/assets/og-image.png`) is copied by Vite's `publicDir` (this retired `scripts/copy-static.mjs`).
`functions/`, `scripts/`, and tooling stay at the repo root, unserved (`partials/` retired by A69).

**Pinned at the deploy root** (Cloudflare Pages requires it — these cannot move):

- `functions/` — Pages Functions are resolved from the project root.
- `static/_headers`, `static/_redirects` — copied to the output root, where they take effect.
- `static/robots.txt`, `static/sitemap.xml`, the favicon (`src/assets/favicon.svg`), and the pages
  that serve at `/…` (`src/index.html`, `src/howto.html`, `src/roadmap.html`, `src/changelog.html`,
  `src/legal.html`, `src/admin.html`).

**Consequence — moving any browser-served file changes its URL, hard-coded in several places that
must be updated in lockstep.** Before relocating anything under `src/` or `static/` (or renaming a
page), update *all* of:

| Coupling point | What it hard-codes |
| --- | --- |
| Absolute URL references in HTML/JS | `/app/…`, `/assets/…`, `/data/*.json`, `/api/*` `fetch()`es |
| `static/_redirects` | `/app/ → /app/app.html` rewrite |
| `static/_headers` | CSP `connect-src 'self'` assumes same-origin `/api`, `/data`, `/app` |
| `static/robots.txt` / `static/sitemap.xml` | `/app/`, `/admin.html`, and the public-page canonical URLs (CH5/CH6) |
| Page `<link rel="canonical">` + OG tags | the canonical URL of each marketing page (CH5) |
| `vite.config.mjs` | `root: 'src'`, `publicDir: static/`, `outDir: dist/`, the 10 `rollupOptions.input` entry paths + the `ssg()` page list (A69) |
| `scripts/vite-ssg.mjs` | maps each site page's URL → its `src/site/components/*.svelte` component (A69 prerender; A95 moved it under `scripts/`) |
| `scripts/build-manifest.mjs` | hashes `static/data/*.json`, with an explicit filename exclude-set |
| `scripts/bump-version.mjs` | classifies prod-shipping surfaces by the `src/app/`, `src/lib/`, `src/site/`, `src/assets/`, `static/data/` prefixes + specific filenames |

`dist/` is gitignored; CI's drift gate proves the build-time tooling (`build-manifest`) didn't leave
committed sources stale. (A69 retired `scripts/build-includes.mjs` and its drift-gate half — the
nav/footer partials became `Nav.svelte`/`Footer.svelte` and the site pages are prerendered, so no
committed HTML is generated from partials anymore.)

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
`src/app/main.ts`, adapting via `document.body.dataset.mode` (`PAGE_MODE`).
**App** (`data-mode="app"`) uses the real IndexedDB `Store`; **Demo** (`data-mode="demo"`)
uses the in-memory `DemoStore` and never persists; **Staging** (`data-mode="staging"`)
uses an isolated IndexedDB and seeds the sample dataset. The store is chosen by `PAGE_MODE`
and handed to the app via a `context('bb:store')` seam (A4/A31), so the UI is
source-agnostic and the demo's no-persist invariant holds by construction.

The **pure-logic core is reused verbatim** (A29, JS→TS per A61) — `core.ts` (compute + costModel + the
event bus), `adapters.ts`, `store.ts` / `demostore.ts`, `curveseries.ts`, `report.ts`,
`sampledata.ts`, and the shared `format.ts` (all `src/lib/core/*.ts`) are TS modules imported unchanged by the Svelte
components. Reactive state lives in Svelte runes (`$state`/`$derived`) inside the components,
not in a shared globals object. Boot runs `loadRefData()` → `Store.init()` → `restoreSession()`
(demo seeds in-memory; staging seeds its DB first), then `mount()`s the app.

> *History:* the original app was a monolithic `app.js`, split (A2) into concern-scoped scripts
> and then (A20) migrated to native ES modules with reassignable state on `app/state.js`. The
> **A33 cutover deleted that vanilla view layer** (`render`/`ui`/`export`/`datamanager`/`widgets`/
> `main`/`state` and the `partials/app-*.html` fragments) in favor of the Svelte SPA — see
> [ADR-001](adr-001-vite-svelte-spa.md). Only the pure-logic core survived, unchanged.

The activity terminal, definitions, and status banners are now Svelte components under
`src/app/parts/` (the redesigned screens live in `src/app/screens/`). The `core.ts` event bus
remains (emitters re-wired in A151 after the cutover dropped them): `loadRefData` emits
`refdata:loaded`, and the shared actions fire `app:ready` (first, at boot start — A195),
`data:loaded`, `data:imported`, `note:saved`, `trade:deleted`, `backup:created`, `data:erased`,
`filter:saved`, `filter:applied`, and `tab:created` over an `EventTarget` for any listener; a
50-entry replay buffer (`busLog()`, A188) lets the ActivityTerminal backfill boot events, and the
bus stays a no-op when nothing subscribes.

## Shared chrome: tokens + Svelte components

To kill copy-paste drift across the info site, two things are single-sourced:

- **Design tokens** live in [`tailwind.css`](../src/styles/tailwind.css) (ADR-002; `tokens.css` is
  deleted). It defines the canonical shadcn-svelte semantic set (`background`/`foreground`/`card`/
  `popover`/`primary`/`secondary`/`muted`/`accent`/`destructive`/`border`/`input`/`ring` + the
  trading-domain `chart-1..5` hues) in `:root` and maps them into Tailwind's theme namespace via
  `@theme inline`, so components style with semantic utilities (`bg-card`, `text-muted-foreground`,
  `bg-primary`, `border-border`, `text-chart-2` = positive P&L, `text-destructive` = negative).
  The utility sheet ships on every surface. Change a color in one place.
- **Shared chrome is Svelte components (A69).** The info-site nav + footer are
  [`Nav.svelte`](../src/site/lib/Nav.svelte) / [`Footer.svelte`](../src/site/lib/Footer.svelte), and
  [`SiteShell.svelte`](../src/site/lib/SiteShell.svelte) composes them around the page content and
  owns the site-wide base styles (resets, typography, `.note`/`.panel`) once — so each page component
  carries only its own page-specific CSS. An `active` prop highlights the current nav link, and a
  `variant="admin"` renders the trimmed, marketing-free admin chrome (A9). This replaced
  `partials/{nav,footer}.html` + `scripts/build-includes.mjs` (retired by A69); the per-surface
  `partials/app-*.html` fragments were already deleted in the A33 cutover.

The marketing/info pages are a **build-time Svelte SSG** (no SvelteKit; A62 deferred):
[`scripts/vite-ssg.mjs`](../scripts/vite-ssg.mjs) server-renders each page component (`svelte/server` `render()`)
into its committed template's `<!--ssg-outlet-->` so every page ships as static, fully-rendered HTML
(SEO + first paint) and then hydrates in place via a small client entry — **NOT** pulled behind the
app SPA shell (ADR-001). The three app surfaces (`app/{app,demo,staging}.html`) are likewise
hand-authored Svelte mount points; they differ only by `<body data-mode="…">`, and all mode-gating
lives in the Svelte app. The **homepage and admin keep their own bespoke chrome** by design (A9) —
the info pages share `Nav`/`Footer`/`SiteShell`; every surface shares the tokens.

## Input: the CSV

Blotterbook reads CSV exports from a trading **platform** and **auto-detects** the
format. The flow is two-step so a bad file never silently corrupts your data:

1. **Load CSV** → the file is parsed and the platform is detected (overridable
   from the **Platform** dropdown). A status line confirms what was found (e.g.
   *Detected TradingView · 63 trades ready*) or explains the problem.
2. **Start Blotterbook** (landing) or **Import** (Manage data) commits the parsed
   trades.

`.csv`/`.txt`/`.tsv` files are accepted (plus `.xlsx` for the ATAS X statistics export, F52 —
routed through `xlsx.ts` into the same CSV-text pipeline before the normal gates apply), and
nothing loads until a parse succeeds.

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
`src/lib/core/adapters.ts` is a small registry (the exported `Adapters`, imported by the Svelte app) with:

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

Supported platforms: **TradingView** (balance history + order history),
**Tradovate/NinjaTrader** (orders + performance + fills), **Quantower**, and
**ATAS X** (via the `.xlsx` statistics export, F52) are verified against real
exports (A209). **Rithmic R\|Trader, Sierra Chart, TradeStation, MotiveWave,
Webull, Interactive Brokers, Schwab/thinkorswim** are `beta` — built from
documented formats and exercised by `scripts/test-adapters.mjs` with synthetic
samples. They're flagged *(beta — verify the numbers)* in the UI until validated
against a real export (tracked in backlog **A103**). **Adding a platform** = one
object in `adapters.ts` (`sniff` + `toTrades` + `minScore`) and a fixture in the
test.

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
app code changes. Brokers modeled: **AMP, EdgeClear, Discount Trading, Tradovate /
NinjaTrader, Optimus, Charles Schwab (thinkorswim), Interactive Brokers,
TradeStation, TradingView PaperTrade** (zero commission).

| File | Contents |
| --- | --- |
| `brokers.json` | `order` + `brokers` (per-side commission for `micro`/`std`). |
| `exchange-fees.json` | `exchange` (fee per root), `micro` set, `notMicro` list (A171 — full-size M-prefixed roots), and a `fallback`. |
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

Trade data and day-notes are stored in **IndexedDB** via `src/lib/core/store.ts`. Nothing
is uploaded.

- **Stores (DB v3):** `trades` (keyed by the dedupe id), `journal` (per-day notes
  keyed by date — each a `{text, tags, shots}` annotation), `meta` (setup + saved
  filters), `trademeta` (per-trade tags/note/screenshots, keyed by trade id; added
  in DB v2), and `files`/`filetext` (per-file CSV provenance — metadata and the
  raw text stored in separate stores so listing the library never loads
  megabytes; added in DB v3, F37).
- **Delta merge:** `Store.addTrades()` skips ids already present, so re-imports
  only add new trades.
- **Demo data is never persisted** — it lives in memory only.
- **Erase all local data** (Manage data → Danger zone) calls `Store.purge()` to
  wipe all six stores after a confirm.

The app never touches `indexedDB` directly — it goes through the `Store`
interface. A future cloud backend implements the same interface, so adding cloud
sync won't touch the rest of the app. The manager added `deleteTrade`,
`getAllJournal`, `deleteJournal`, `getAllMeta`,
`getTradeMeta`/`saveTradeMeta`/`deleteTradeMeta`/`allTradeMeta`, `exportAll`,
`importAll`, and (F37 per-file provenance) `getFiles`/`addFile`/`updateFile`/
`deleteFile`/`getFileText`/`filesBytes` to that interface.

Separate, unrelated version numbers are intentionally **not** touched by the
release automation: `store.ts` `DB_VERSION` (IndexedDB schema), the backup-file
`version`, and `manifest.json` content hashes.

## Staging sandbox

`app/staging.html` (`body[data-mode="staging"]`) is a **clone of the main app**,
launched from the admin page (**Launch staging env**) to trial changes before they
reach the main app. It uses an **isolated IndexedDB** (`blotterbookStaging`, set in
`store.ts`) so testing never touches real data, and **seeds the sample dataset
once** so it opens in the loaded state. It has the full top bar including **Manage
data** and the **Load CSV** landing; notes/tags/filters persist to its own DB.

**Staging is key-gated.** `functions/_middleware.ts` gates `/app/staging.html`: it
requires the `ADMIN_KEY` via an `x-admin-key` header or a `bb_staging` cookie (if
`ADMIN_KEY` isn't configured, staging stays open). Browsers can't set request
headers on a navigation, so the admin panel's **Launch staging env** button sets
the short-lived path-scoped `bb_staging` cookie before opening the page — the token
never travels in the URL (S19).

After the CH16 redesign cutover, the whole redesigned app ships to every surface, so
per-surface behavior is decided by `PAGE_MODE` (with `isStaging`/`isDemo` derived from it) —
the standalone `STAGING_PAGE` export was removed. What remains staging-specific is only the
staging **environment**: the isolated `blotterbookStaging` DB, the one-time sample seed, the
"open on the initial state" landing, and the **Exit staging** affordance — all keyed off
`PAGE_MODE === 'staging'`. The redesigned features it once proved (dashboard modules, activity
terminal, definitions, status banners) are now ordinary Svelte components under `src/app/screens/`
and `src/app/parts/`, rendered on every surface.

## Building a feature (all surfaces share one SPA)

Since the A33 cutover (and the CH16 redesign cutover), all three surfaces (app + demo + staging)
**mount the same Svelte SPA** from `src/app/main.ts` — one mode-aware redesigned `App.svelte`
(sidebar `AppShell` + hash router over `src/app/screens/*` + `src/app/parts/*`), with no per-surface
root. There is no separate staging codebase to "promote" from. A feature you add to the Svelte app
appears on every surface at once; the surface a behavior shows on is decided **in the component** by
`PAGE_MODE` / `isDemo` / `isStaging`, not by where the code lives.

**The model in one breath.** The **demo mirrors prod 1:1**: every feature the main app has, the
demo has too — just with data-mutating controls **disabled** and persistence blocked (the
in-memory `DemoStore` + `isDemo` guards). Staging is the same app on an isolated DB; the only
staging-exclusive surface is `app/staging.html` itself (env chrome, key gate). The two version
tracks in `data/versions.json` are **independent counters** — any change to a shared core module
or a Svelte component bumps **both** (it ships to all surfaces).

**Checklist for a new feature:**

1. **Build it in `src/app/`** — a screen/part (or extend one), reusing the pure-logic
   core (`core.ts`/`adapters.ts`/`store.ts`/…) verbatim. Read/write data only through the `Store`
   handed in via `context('bb:store')`, never `indexedDB` directly.
2. **Gate per surface in the component** — e.g. `{#if isStaging}` for staging-env-only chrome.
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
2. **Which track** from the changed paths (A30 paths; A69 site) — any **prod-shipping** file (the
   pure-logic core `src/lib/core/*.ts`, the shared UI primitives `src/lib/components/**`,
   `src/lib/utils.ts`, the Svelte SPA `src/app/**` `.ts`/`.svelte`, `src/app/app.html`/`demo.html`,
   `src/assets/*`, `src/styles/tailwind.css`, `static/data/*`
   except versions/backlog/changelog json) bumps **both** prod and staging; **only**
   `src/app/staging.html` bumps staging alone; the marketing/info site (`src/index.html` +
   `src/{howto,roadmap,changelog,legal}.html` + their `src/site/**` Svelte components, shared chrome,
   and client entries — A69) bumps prod alone; everything else (the internal admin page —
   `src/admin.html`/`Admin.svelte`/`admin.ts` — README, `.github`, scripts, functions) bumps nothing.

It writes `data/versions.json` and commits it back to `main` as
`chore(release): … [skip ci]` (so it doesn't re-trigger itself). **Requires** the
GitHub Actions bot to be allowed to push to `main`; if the branch is protected the
job logs a warning instead of failing.

**Display is runtime-fetched.** Each page's `.ver` badge is populated at load from
`/data/versions.json` (the version-badge helper lives in `src/lib/core/format.ts`, used by the SSG
info pages; the Svelte app fetches it on boot), so there's no baked literal to keep in sync
anymore. The admin panel surfaces the
same values **read-only**.

## Changelog release notes

`changelog.html` → its Svelte SSG component `src/site/components/Changelog.svelte` renders **`/data/changelog.json`** (F13): a
curated, version-keyed release-notes file for the **prod** (main + demo) track,
newest first. Each entry has a prod `version`, a `date`, a friendly
`title`/`summary`, and optional `highlights`. Everything before automated
versioning is rolled up into a single `beta: true` "Beta released" entry.

It is **manually curated** — add a new entry at the top of `releases` each time the
prod version bumps. This deliberately replaces the old raw-commit feed so the page
reads as release notes, not a git log. The file is hash-cache-busted by
`build-manifest` like other `data/*.json`; `Changelog.svelte` keeps a tiny
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
metadata (`request.cf`) — no IP or third-party service, nothing stored. **The endpoint is
deployed but currently unwired**: nothing in `src/` calls `/api/geo` since the CH16 cutover
(the legal page's outbound-call inventory reflects this — A181). Re-wiring it to pre-select
the tax state is a candidate future enhancement; it must never override a chosen/saved state.

## Marketing & info site

The site root (`index.html`) is a **single-page, scrollable marketing site**,
styled with the same dark palette and tokens as the app. A sticky header carries
anchor links plus links to the standalone info pages. On narrow screens the nav
links collapse behind a **hamburger menu** (a CSS-only checkbox toggle on every
page).

**Standalone info pages** (Svelte SSG sharing `Nav`/`Footer`/`SiteShell` chrome; page CSS is scoped per component, A69): `howto.html` (a How-To wiki with a
sticky sidebar — getting-started walkthrough + per-platform import guides),
`roadmap.html` (shipped-vs-planned checklist), `changelog.html` ("Blotterlog"
release notes), and `legal.html` (disclaimers, terms, privacy summary).

## Known limitations

- **Drawdown is realized only** — from the closed-trade curve; no open-position
  heat.
- **Hold time depends on the export** — fills-based imports get hold time from the
  round-trip matcher; closed-position exports like TradingView carry only the close
  timestamp.
- **Beta adapters need real-export validation** — 7 of the 14 adapters (Rithmic,
  Sierra Chart, TradeStation, MotiveWave, Webull, Interactive Brokers,
  Schwab/thinkorswim) are still built from documented formats and synthetic
  tests, not a real export (backlog **A103**). Header changes on a platform's
  side can break detection.
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
