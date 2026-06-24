<p align="center">
  <img src="assets/banner.svg" alt="Blotterbook — private futures journal and cost dashboard" width="100%">
</p>

<p align="center">
  <img alt="No dependencies" src="https://img.shields.io/badge/dependencies-none-3fb950?style=flat-square&labelColor=151a21">
  <img alt="Runs in browser" src="https://img.shields.io/badge/compute-browser%20only-d6dde6?style=flat-square&labelColor=151a21">
  <img alt="Local storage" src="https://img.shields.io/badge/storage-IndexedDB%20(local)-6aa0ff?style=flat-square&labelColor=151a21">
  <img alt="Hosting" src="https://img.shields.io/badge/hosting-Cloudflare%20Pages-e3b341?style=flat-square&labelColor=151a21">
  <img alt="Privacy" src="https://img.shields.io/badge/data-never%20leaves%20your%20browser-c98bff?style=flat-square&labelColor=151a21">
</p>

---

**Blotterbook** is a **dependency-free** trading journal and cost dashboard for futures traders. It
reads a balance-history CSV exported from **TradingView**, parses it entirely in the browser, stores
it **locally** (IndexedDB), and renders performance, calendar, cost, filter, and statistics views.
All computation is client-side and **no trade data ever leaves the browser**. The only network
call is loading the app's own reference-data JSON.

> **Design pillars (intentional constraints):** compute happens locally, there are **no runtime
> dependencies**, and the whole thing deploys as static files to **Cloudflare Pages**. The app
> *is* split across files (it used to be one `index.html`), so it must be **served over http(s)** —
> opening it from disk will block the `fetch()` of the reference data.

## Table of contents

- [Project layout](#project-layout)
- [Marketing homepage](#marketing-homepage) — the one-page site at `/`
- [Quick start](#quick-start)
- [Input: the CSV](#input-the-csv) — and how re-uploads merge
- [Platform adapters & auto-detection](#platform-adapters--auto-detection) — multi-platform CSV import
- [UI walkthrough](#ui-walkthrough)
- [Cost model](#cost-model) — commissions, subscriptions, tax
- [Reference data (JSON)](#reference-data-json) — brokers, fees, feeds, states + cache-busting
- [Local persistence](#local-persistence) — IndexedDB, delta merge, purge
- [Managing local data](#managing-local-data) — edit, back up, and restore
- [Filters & journal](#filters--journal)
- [Architecture](#architecture)
- [Pricing & tiers (scaffold)](#pricing--tiers-scaffold)
- [Roadmap](#roadmap)
- [Known limitations](#known-limitations)
- [Privacy](#privacy)
- [Development & deployment](#development--deployment)
- [License](#license)

## Project layout

```
/                       marketing + info site (own CSS in index.html; site.css for the rest)
  index.html            homepage: hero + features + use cases + platforms + pricing + FAQ
  howto.html            "How To" wiki: getting-started walkthrough + per-platform import guides
  roadmap.html          shipped vs. planned checklist (styled like the changelog)
  changelog.html        "Blotterlog" — commit history (reads the cached /api/changelog endpoint)
  legal.html            disclaimers, terms of use, privacy summary
  admin.html            internal admin controls (Cloudflare Access–gated; sets the Live indicator)
  site.css              shared styles for howto / roadmap / changelog / legal / admin
/app/                   the journal app
  index.html            app markup (links app.css + app.js)
  demo.html             the demo on its own page (shares app.css/app.js; opens in a new tab)
  staging.html          1:1 sandbox copy of the demo (body[data-mode=staging]) for trialling changes
  app.css               all app styles (shared by index.html / demo.html / staging.html)
  app.js                the main app script (shared; mode-aware via body[data-mode])
  adapters.js           platform CSV adapters + format auto-detection + fills matcher
  store.js              IndexedDB persistence (trades, journal, meta, per-trade trademeta)
  entitlements.js       storage-tier resolver (scaffold; always "local" today)
/data/                  reference data, fetched at runtime
  brokers.json          broker commission tiers
  exchange-fees.json    CME exchange/clearing/NFA fees + micro set
  feeds.json            per-broker market-data feed options
  state-tax.json        Section 1256 model + per-state top rates
  manifest.json         content hashes for cache-busting (generated)
/functions/             Cloudflare Pages Functions
  api/changelog.js      cached (1h) GitHub commit feed for the changelog page
  api/geo.js            visitor region (Cloudflare edge geo) → pre-fill the tax state
  api/status.js         homepage Live-indicator status (GET public; POST admin-only, KV-backed)
  api/{me,checkout,webhook}.js   Stripe/accounts scaffold
  README.md             accounts/payments/storage-tier plan
/scripts/
  build-manifest.mjs    regenerates data/manifest.json (Node built-ins only)
  test-adapters.cjs     synthetic tests for the platform adapters (node scripts/test-adapters.cjs)
/assets/banner.svg
/assets/favicon.svg     site favicon (the gradient square from the wordmark)
LICENSE                 proprietary — all rights reserved
```

## Marketing &amp; info site

The site root (`index.html`) is a **single-page, scrollable marketing site** for Blotterbook,
styled with the same dark palette and tokens as the app. A minimalist sticky header carries
anchor links plus links to the standalone info pages:

| Section | Purpose |
| --- | --- |
| **Home** | The hero (banner, tagline) with **Launch Blotterbook** and **See Demo** CTAs, plus a **Live** status pill — it honors an admin override from `/api/status` and otherwise pings `/app/`. |
| **Features** | A three-column grid of the app's capabilities (privacy, cost model, tax, broker comparison, curve/calendar, stats). |
| **Use Cases** | The pitch — Blotterbook as both a profit/budgeting calculator and a private journal. |
| **Platforms** | A grid of supported import platforms, each badged **Verified · real data** (TradingView) or **Beta · synthetic** (the rest), linking to the How-To guides. |
| **Pricing** | Two cards: **Blotterbook — Free** and a greyed-out, planned **Online app (~$49/mo)**. The current CSV-driven app stays free. |
| **FAQ** | Expandable questions covering supported data, cost/tax modeling, and limitations. |

**Standalone info pages** (share `site.css`):

- **`howto.html`** — a How-To wiki with a sticky sidebar: a getting-started walkthrough (with
  non-interactive mockups of the app's modules) and a per-platform import guide for each supported
  export, each marked verified vs. synthetic-tested.
- **`roadmap.html`** — a shipped-vs-planned checklist (shipped items crossed off; planned items
  flagged with priority), styled like the changelog.
- **`changelog.html`** ("**Blotterlog**") — the commit history. It now reads our own cached
  **`/api/changelog`** endpoint (see [below](#changelog-caching)) instead of calling GitHub on every
  visit, and falls back to a baked-in snapshot if the endpoint is unavailable.
- **`legal.html`** — disclaimers (not a broker, estimates only), terms of use, and a privacy summary,
  linked from every footer alongside a one-line disclaimer.

### Changelog caching

`functions/api/changelog.js` is a Cloudflare Pages Function that fetches the repo's recent commits
and caches the response at the edge for **one hour** (Cache API + `Cache-Control`). GitHub is hit at
most ~once/hour per edge location regardless of traffic, and the data still updates **without a
redeploy** — it's fetched live, just cached. (A single global once-an-hour refresh would use a
Cron-Triggered Worker writing to KV; the Cache-API version is the Pages-native equivalent.)

### Location-based tax state

`functions/api/geo.js` returns the visitor's coarse region from Cloudflare's edge metadata
(`request.cf`), and the app calls `/api/geo` on the landing screen to **pre-select the US state** for
the tax estimate. No IP or third-party service, nothing stored; it never overrides a chosen/saved
state and silently does nothing off-Cloudflare or outside the US.

### Admin page &amp; the Live indicator

`admin.html` is an internal control page (and a `/api/status` Pages Function). It can set the
homepage's **Live** pill and **launch the staging sandbox**. The pill first reads `/api/status`: if an
admin has set a fixed status (**Live**, **Offline**, or **Maintenance**, with an optional custom
label) it shows that; otherwise (**Auto**) it falls back to pinging `/app/`. `GET /api/status` is
public (the homepage needs it); writes are admin-only.

**Backend setup:** bind a **KV namespace** as `STATUS_KV` to the Pages project (stores the status),
and set an **`ADMIN_KEY`** secret (`POST /api/status` requires a matching `x-admin-key` header).

**Serving admin at `admin.blotterbook.com` (not `blotterbook.com/admin`) behind Zero Trust:**

1. **Add the subdomain to the Pages project.** Pages → your project → *Custom domains* → *Set up a
   custom domain* → `admin.blotterbook.com` (Cloudflare creates the CNAME automatically since the zone
   is on Cloudflare).
2. **Point the subdomain root at `admin.html`.** A custom domain serves the whole site, so map the
   subdomain's `/` to the admin page with a **Redirect Rule** (Rules → *Redirect Rules* → Create):
   *When* `hostname equals admin.blotterbook.com` *and* `URI path equals /` → *Static redirect* to
   `https://admin.blotterbook.com/admin.html` (302). (Or use a Transform/Rewrite rule to rewrite the
   path without a visible redirect.)
3. **Lock it down with Cloudflare Zero Trust (Access).** Zero Trust dashboard → *Access* →
   *Applications* → *Add an application* → **Self-hosted** → Application domain `admin.blotterbook.com`
   (add a second domain/path for `blotterbook.com/admin*` and `blotterbook.com/admin.html` so the page
   can't be reached on the apex). Add a **policy**: action *Allow*, rule e.g. *Emails* = your address
   (or a Google/GitHub identity provider). Optionally add `blotterbook.com/api/status` to require Access
   on writes too. Save — Cloudflare now forces login before the admin page or its writes resolve.
4. **Keep the `ADMIN_KEY` layer.** Even behind Access, the admin page still sends `x-admin-key`, so
   `POST /api/status` is defended by both Access *and* the secret.

The admin page degrades gracefully off Cloudflare (locally `/api/status` 404s and it shows
"deploy on Cloudflare to use").

### Staging sandbox

`app/staging.html` (`body[data-mode="staging"]`) is a **1:1 copy of the demo** — full app on the
generated sample dataset, never persisted — used to trial UI/behavior changes before they reach the
main app. The admin page has a **Launch staging env** button. Staging additionally enables the
experimental **web-grid dashboard** (the "Main-app web UI redesign" trial): single column on mobile,
and at ≥1100px a multi-column grid with the performance graph across the top, the calendar and
break-even side-by-side, and the statistics in a right-hand column.

### Mobile navigation

On narrow screens the header's nav links collapse behind a **hamburger menu** that replaces the
Launch button; tapping it drops down the full nav (including a Launch link). Implemented with a
CSS-only checkbox toggle on every page (homepage + the shared `site.css` pages).

## Quick start

1. Serve the folder over http (see [Development](#development--deployment)) and open `/app/`.
   The homepage at `/` links to it (**Launch Blotterbook**).
2. In the centered **Broker & Costs** panel, choose your **Broker**, **Data feed**, and **State**,
   and set the monthly **Platform fee**. (Load CSV is disabled until all three are chosen.)
3. In TradingView, export your account balance history as CSV.
4. Click **Load CSV** and select the file. Your data is saved locally — it's restored
   automatically next time you open the app. Load more CSVs later from **Manage data → Load CSV**.

Prefer to look around first? Open **See Demo** on the homepage for a generated, profitable two-year
sample dataset (not saved). To erase your data, use **Manage data → Erase all local data**.

## Input: the CSV

Blotterbook reads CSV exports from a trading **platform** and **auto-detects** the format — see
[Platform adapters](#platform-adapters--auto-detection). The flow is two-step so a bad file never
silently corrupts your data:

1. **Load CSV** → the file is parsed and the platform is detected (you can override it from the
   **Platform** dropdown). A status line confirms what was found (e.g. *Detected TradingView · 63
   trades ready*) or explains the problem.
2. **Start Blotterbook** (landing) or **Import** (Manage data) commits the parsed trades.

Only `.csv` files are accepted, and nothing loads until a parse succeeds.

The reference format is the **TradingView** "List of trades" export — required columns (matched
case-insensitively by substring): **`Time`**, **`Realized PnL (value)`** (falls back to
`Realized PnL`), and **`Action`**. Each row is one trade — a position-*close* event with its own
realized PnL; the instrument comes from the `Action` text and reduces to a **root ticker**
(`MESM2025` → `MES`, `MES1!` → `MES`, `M2KZ2025` → `M2K`).

```
Time,Action,Realized PnL (value)
2026-06-02 10:00:00,"Close long position for symbol MESM2025 at price 5300.00",75.00
```

**Re-uploads merge.** Each trade gets a stable id from its `time + symbol + side + pnl`. Uploading
a CSV that overlaps a previous one only inserts the genuinely new rows, so you can export a wider
window each time without creating duplicates. The data summary shows `+N new · M dup`.

## Platform adapters & auto-detection

Parsing is keyed to the trading **platform** the CSV came from (TradingView, Tradovate, …) — **not**
the broker. The two are independent: you might clear through **AMP** but export from **TradingView**.
The Broker dropdown only drives the cost model; the Platform dropdown (and the detector) drives
parsing. `app/adapters.js` is a small registry — `window.Adapters` — with:

- **`detect(text)`** — sniffs the header row against each adapter's signature columns and returns the
  best match (e.g. Tradovate has `B/S` + `Contract`; Rithmic has `Buy/Sell` + `Qty Filled`; IBKR has
  `DateTime` + `Buy/Sell` + `Proceeds`). No match → the user picks the platform manually.
- **`parse(text, platformId?)`** — runs the chosen (or detected) adapter and returns
  `{ ok, trades, platform, label, beta, … }` or `{ ok:false, error }`.

Every adapter **normalizes to the same internal trade shape** — `{ time, date, pnl, symbol, root,
side[, qty, entryTime, exitTime, holdMs] }` — so `compute()` / `costModel()` never change. Two export
styles are handled:

- **Closed positions** — each row is a finished trade with realized PnL (**TradingView**,
  **MotiveWave**).
- **Fills** — individual buy/sell executions. A FIFO **round-trip matcher** (`pairFills()`) pairs
  entries→exits per symbol to build closed trades — and that finally unlocks **hold time** (shown as
  *Avg Hold Time* in Advanced Statistics when available). When a fills export carries realized PnL per
  closing row (IBKR), it's used directly; otherwise PnL is computed from price × a built-in futures
  **point-value** map (unknown roots default to ×1, correct for equities).

Supported platforms: **TradingView** (verified), plus **Tradovate, Rithmic R\|Trader, Sierra Chart,
TradeStation, MotiveWave, Webull, Interactive Brokers, Schwab/thinkorswim** — these are `beta`,
built from documented formats and exercised by `scripts/test-adapters.cjs` with synthetic samples.
They're flagged *(beta — verify the numbers)* in the UI until validated against a real export.
**Adding a platform** = one object in `adapters.js` (`sniff` + `toTrades`) and a fixture in the test.

## UI walkthrough

| Section | What it shows |
| --- | --- |
| **Top bar** | The **Blotterbook** wordmark (links to the homepage) and the loaded-source text — once data is loaded, clicking it opens **Manage data** (it does nothing before load); it's truncated so long filenames don't bloat the bar. Actions: **Changelog**, **Export report**, **Manage data**, Contact. |
| **Landing (no data)** | The intro and the **Broker & Costs** module sit centered as a group (like the homepage hero). **Load CSV** is always available — pick a file and a **Platform** dropdown (auto-filled by the detector) plus a parse-status line appear. **Start Blotterbook** commits and enters the app; it stays disabled until a CSV parses *and* broker/feed/state are chosen (the gate moved off Load CSV onto Start). |
| **Broker & Costs** | Broker (incl. **TradingView PaperTrade**) / data feed / platform fee / state. Drives the cost model only — independent of the CSV's platform. **Starts minimized** once data is loaded (the load/Start controls are hidden); selections persist. |
| **Scope toggle** | Switches most views between *All time* and the *Selected month*. |
| **Filters** | Date range, symbol, side, session (RTH/ETH), **tag** (when any per-trade tags exist), and day-of-week. Applies before everything. |
| **Stat cards** | Net PnL (+ take-home), win rate, profit factor, avg win/loss, max drawdown. |
| **Performance** | Cumulative PnL vs. date, with stepped y-axis gridlines and a gradient area fill. Click the **Gross / Net / Take-home** buttons to toggle overlays (at least one stays on); hover for values; **click anywhere on the graph to select that date and jump the calendar to its month**. |
| **Trading Calendar** | Sunday-first month grid of daily PnL with weekly summaries and a **jump-to-latest** arrow (snaps to the most recent month of data); **day-notes** below. Clicking a day marks it on the graph. |
| **Break-even & Cost Budget** | Per-symbol commission table and a full-width itemized waterfall — gross, commissions, subscriptions, net pre-tax, the folded-in **Section 1256** tax detail, take-home, and break-even/trade. |
| **Advanced Statistics** | Daily averages, expectancy, long/short split, best/worst day & weekday, Sharpe, streaks, and **Avg Hold Time** (when the import was a fills export). |
| **Definitions & Caveats** | How each number is computed and where the data falls short. |

**Demo (its own page).** The demo lives at `app/demo.html` and is reached from the homepage
(**See Demo**), not the app. It's the full app on a generated, profitable **two years** of sample
data, minus the Load CSV / Manage data controls; an **End demo** button returns to the homepage
(closing the tab when the browser allows). The header shows a purple **DEMO** badge. Demo data is
in-memory only and never persists.

**Export report.** **Export report** opens a condensed **performance report** in a new tab — period
summary tiles, a cost &amp; tax breakdown, key statistics, and per-symbol commissions, in the
Blotterbook palette. It reads like a report rather than a screenshot of the dashboard, and does
**not** auto-print. The report page has a **Download** button (saves a self-contained `.html` copy)
and an **Email a copy** button (opens a mailto with a plaintext summary). (Allow pop-ups for the
report tab.)

**Manage data.** **Manage data** opens a local-data manager (see
[Managing local data](#managing-local-data)).

## Cost model

Costs are applied to whatever scope **and filters** are active.

**Commissions (per symbol, broker-aware):**

```
all-in per side = broker commission (micro|standard tier) + CME exchange/clearing/NFA fee
round-turn per trade = 2 × all-in per side          (one entry + one exit, 1 contract)
```

The broker commission comes from `brokers.json`; the exchange fee from `exchange-fees.json`. A
symbol's tier (micro vs. standard) is from that file's `micro` list, falling back to a heuristic
(`M`-prefixed roots are treated as micros). Unknown symbols use a fallback and are flagged `*`.

**Subscriptions (not prorated):** `platform fee + data-feed fee` is charged as a **full month for
every distinct calendar month** present in the active scope — never prorated by day.

**Tax (Section 1256, estimated):**

```
blended rate = ltcgWeight × ltcg + ordinaryWeight × fedOrdinary + state top marginal rate
            = 0.60 × 15%  + 0.40 × 24% + state rate            (defaults, from state-tax.json)
```

Applied to net pre-tax profit **only when positive**. A rough planning estimate, not tax advice.

**Break-even per trade:** `(total commissions + subscriptions) ÷ trade count`.

## Reference data (JSON)

The broker/fee/feed/state tables used to be inline constants; they now live in `/data/*.json` and
are fetched at runtime by `loadRefData()` before anything renders. Edit a JSON file to change
rates — no app code changes. Brokers modeled: **AMP, EdgeClear, Tradovate / NinjaTrader, Optimus,
Charles Schwab (thinkorswim), Interactive Brokers, TradeStation, TradingView PaperTrade** (zero
commission; its feed list mirrors TradingView's real-time data add-ons, with a single catch-all
*Free realtime feed* for the no-cost exchanges).

| File | Contents |
| --- | --- |
| `brokers.json` | `order` + `brokers` (per-side commission for `micro`/`std`). |
| `exchange-fees.json` | `exchange` (fee per root), `micro` set, and a `fallback`. |
| `feeds.json` | `shared` feed sets + `brokerFeeds` (a broker may alias a shared set by name, e.g. `"AMP": "CQG"`). |
| `state-tax.json` | `model` (`fedOrdinary`, `ltcg`, weights) + `states` (`[abbr, ratePct, label]`). |

### `schemaVersion` + content-hash cache-busting

Every data file carries a **`schemaVersion`** field, and `scripts/build-manifest.mjs` writes
`data/manifest.json` mapping each file to a short SHA-256 **content hash**. At boot the app fetches
`manifest.json` with `no-cache`, then requests each data file as `brokers.json?v=<hash>`.

**What this buys us:**

- **Aggressive caching with instant updates.** Because the URL only changes when the file's bytes
  change, the data files can be cached forever by the browser and Cloudflare's edge — yet an edit
  takes effect immediately (new bytes → new hash → new URL → cache miss). No more "users stuck on
  stale rates" and no cache-clearing rituals.
- **`schemaVersion` is the contract.** The hash answers *"did these bytes change?"*; the version
  answers *"did the **shape** change?"*. If a file's structure ever changes incompatibly, bump its
  `schemaVersion` and the app can detect a too-new/too-old file and refuse to misread it — instead
  of silently mispricing trades. It also keeps these app-facing data files cleanly versioned
  independently of any future cloud API.

**After editing any data file, run:** `node scripts/build-manifest.mjs` (also a good Cloudflare
Pages build command).

## Local persistence

Trade data and day-notes are stored in **IndexedDB** via `app/store.js`, so your data is restored
automatically on return visits. Nothing is uploaded.

- **Stores:** `trades` (keyed by the dedupe id), `journal` (keyed by date), `meta` (setup
  selections).
- **Delta merge:** `Store.addTrades()` skips ids already present, so re-imports only add new trades.
- **Demo data is never persisted** — it lives in memory only.
- **Erase all local data** (Manage data → Danger zone) calls `Store.purge()` to wipe all three stores after a confirm.

The app never touches `indexedDB` directly — it goes through the `Store` interface. A future cloud
backend implements the same interface, so adding cloud sync won't touch the rest of the app. See
[pricing & tiers](#pricing--tiers-scaffold).

## Managing local data

**Manage data** (top bar, or click the loaded-source text) opens a modal — the single home for all
local-data control. It reuses the existing `Store` interface and keeps loading, backup, and
destructive actions behind one clearly-labeled surface. It has six parts:

- **Overview** — trade count, date range, day-note count, **tagged-trade count**, and the approximate on-disk size.
- **Load data** — *Load CSV* lives here (moved out of the top bar). Picking a file parses and
  auto-detects the platform into the **Platform** dropdown; you then confirm with **Import**, which
  merges only the new trades. The platform choice applies to that one upload — the dropdown resets to
  *Auto-detect* each time the panel reopens (the data is already normalized, so platform stops
  mattering once imported). The very first load is done from the centered Broker & Costs panel on the
  landing.
- **Backup &amp; restore** — *Download backup (.json)* writes a single file with your trades, day-notes,
  and setup (`Store.exportAll()`); *Restore from backup* merges one back in (`Store.importAll()`).
  Restores de-duplicate by the same stable trade id, so re-importing is always safe. This is the
  answer to "local storage is per-browser" — a portable snapshot you control.
- **Day notes** — every dated note, each with a delete button.
- **Trades** — a searchable (symbol / date / side), scrollable table with per-row **Edit** and
  **Delete**. **Edit** opens a per-trade editor for **tags** (comma-separated), a free-text **note**,
  and **screenshots** (image uploads stored as data URLs). Tags show as chips on the row and populate
  the dashboard's **Tag** filter; deletions apply immediately and recompute metrics live.
- **Danger zone** — *Erase all local data* (`Store.purge()`), behind a confirm. (This replaced the
  old top-bar Clear data button.)

Each section renders independently (wrapped in try/catch), so a single failure can't blank the rest.

Per-trade metadata lives in its own IndexedDB store (`trademeta`, keyed by trade id) added in DB
**v2**; it's covered by backup/restore and `purge`. The `Store` interface stays the single source of
truth — the manager added `deleteTrade`, `getAllJournal`, `deleteJournal`, `getAllMeta`,
`getTradeMeta`/`saveTradeMeta`/`deleteTradeMeta`/`allTradeMeta`, `exportAll`, and `importAll`, so a
future cloud backend gets the same management UI for free.

## Filters & journal

**Filters** (apply before scope, cards, graph, calendar, cost, and stats):

- **Date range**, **Symbol** (root), **Side** (long/short).
- **Session** — RTH (09:30–16:00) vs. ETH, by the timestamp's clock time as exported.
- **Tag** — appears once any trade is tagged (Manage data → Edit a trade); filters to trades carrying
  that tag.
- **Day of week** — toggle any subset of S M T W T F S.
- A live `N / M trades` count and a **Reset filters** button.

**Day-notes / journal:** click any calendar day to open a notes editor for that date. Notes
auto-save to IndexedDB; days with a note get a small dot on the calendar. (Disabled for demo data.)
**Per-trade tags, notes &amp; screenshots** are edited from Manage data → Trades → **Edit** (see
[Managing local data](#managing-local-data)).

## Architecture

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
  → render*()       → cards / curve / calendar / advanced / break-even
```

The styles and script live in `app/app.css` and `app/app.js`, shared by both `index.html` and
`demo.html`; `app.js` adapts to the page via `document.body.dataset.mode` (the demo sets
`data-mode="demo"`, auto-loads sample data, and skips persistence). Key globals: `TRADES` (full
merged set), `METRICS_ALL` (metrics for the *filtered* set), `FILTERS`, `SCOPE`,
`calYear`/`calMonth`, `selectedDate`, `JOURNAL_DATES`, `DEMO_MODE`, `DEMO_PAGE`. The boot sequence
is async: `loadRefData()` → `Store.init()` → `restoreSession()` (or `runDemo()` on the demo page).

## Pricing & tiers (scaffold)

**The current app — CSV-driven and Cloudflare-hosted — is free and stays free.** There is **no
one-time/local desktop app** planned; the hosted platform is the product.

The only planned paid tier is a future **online app (~$49/mo)** that would connect **directly to
brokers and trading platforms** for data instead of importing CSVs. It's not built; pricing is
indicative.

| Tier | Bought via | Storage / data | Status |
| --- | --- | --- | --- |
| Free | free to use | IndexedDB (this browser), CSV import | shipped |
| Online (direct-connect) | subscription (~$49/mo) | server-side + live broker/platform feeds | planned |

`/functions/api/{me,checkout,webhook}.js` are stubbed Cloudflare Pages Functions for Stripe
checkout, webhook-driven account provisioning, and tier lookup. `app/entitlements.js` is the client
resolver that will pick the matching `Store` implementation; today it always returns `local`.

## Roadmap

The live, prettier version is [`roadmap.html`](roadmap.html). Highlights, roughly in priority order:

- **Trustworthy live tax rates & data-feed costs** — *(high priority).* These are the platform's
  selling point but are currently hand-maintained estimates (effectively web-scraped). They need real
  sources pulled on a schedule: official CME/exchange fee schedules, per-broker data-feed price lists,
  and per-state tax tables, written into `data/*.json` rather than guessed. See
  [the note below](#sourcing-accurate-rate-data).
- **Validate & harden platform adapters** — confirm the eight `beta` adapters against real exports,
  widen the futures point-value map, add a manual column-mapping fallback for unrecognized formats.
- **Main-app web UI redesign** — *in trial:* a responsive multi-column dashboard for wide screens,
  currently behind the [staging sandbox](#staging-sandbox); promote to the main app once validated.
- **Code review & refactor pass** — a lot landed fast; a deliberate cleanup before the codebase grows.
- **Compliance review session** — disclaimers, data handling, and any wording/registration needs as
  monetization approaches.
- **Journal feature parity** — *started:* per-trade **tags, notes, and screenshots** plus a tag filter
  now ship. *Next:* setups, R-multiple & risk tracking, MAE/MFE, and saved filter views.
- **Accounts + cross-device sync (zero-knowledge)** — end-to-end-encrypted sync so data moves across
  devices without us ever seeing it (Obsidian-Sync-style); removes the re-upload-per-device pain while
  keeping the privacy promise. A `CloudStore` implementing the same `Store` interface.
- **Stripe integration** — finish the checkout / webhook / entitlements flow scaffolded in `/functions`.
- **Direct broker / platform connections** — pull fills, commissions, and rates live (the online tier).
- **Recreate trade charts from CSV** — *(stretch).* Reconstruct a per-trade price/entry-exit chart.

### Sourcing accurate rate data

The cost/tax model is only as good as its inputs, so replacing the hand-maintained estimates is the
top priority. Approach being considered: a scheduled job (Cron-Triggered Worker) that pulls from
authoritative sources — the **CME market-data / fee schedules**, each **broker's published data-feed
price list**, and a **per-state tax-rate table** — normalizes them, and commits updated `data/*.json`
(then `build-manifest.mjs` re-hashes for cache-busting). Where a clean source/API isn't available,
fall back to a maintained snapshot with a visible "as of" date rather than silent scraping, and make
every figure clearly an *estimate* in the UI.

## Known limitations

- **Drawdown is realized only** — from the closed-trade curve; no open-position heat.
- **Hold time depends on the export** — fills-based imports (Tradovate, Rithmic, …) get hold time
  from the round-trip matcher; closed-position exports like TradingView carry only the close
  timestamp, so no hold time is shown for them.
- **Beta adapters need real-export validation** — the eight non-TradingView adapters are built from
  documented formats and synthetic tests; they're flagged *(beta — verify the numbers)* until checked
  against a real file. Header changes on a platform's side can break detection.
- **Fills PnL can approximate** — when a fills export has no realized PnL, it's computed from price ×
  a built-in futures point-value map; unrecognized futures roots fall back to ×1 (correct for
  equities, wrong for an unlisted contract until added to the map).
- **Commissions are modeled** — raw PnL is gross; rates come from the editable JSON and may drift.
- **Calendar-day & session grouping** — both use the literal `Time` value, not the CME session day;
  RTH/ETH assumes the timestamp's clock time.
- **Sharpe is illustrative** — daily PnL, population std, not annualized.
- **Local storage is per-browser** — data is not synced across devices and is cleared if you clear
  site data. Use **Manage data → Download backup** for a portable JSON snapshot in the meantime.
  (Cloud sync is the planned subscription tier.)

## Privacy

All parsing, computation, and storage happen locally in your browser; **trade data is never
uploaded**. No accounts, no tracking, no advertising cookies — the local storage that holds your data
and settings is first-party and essential (so **no GDPR cookie banner is needed**). The only outbound
calls, none of which carry your trades: the app's own `/data/*.json`; `/api/geo` to pre-fill the tax
state from your coarse region (nothing stored); and the changelog reading public commit data via the
cached `/api/changelog` endpoint. The full statement is on [`legal.html`](legal.html).

## Development & deployment

No build step for the app itself. Because the app fetches `/data/*.json`, it **must be served over
http(s)** — don't open the files from disk.

```
# any static server works, e.g.
python3 -m http.server 8000      # then visit http://localhost:8000/app/
```

The repo deploys to **Cloudflare Pages** as static files; `/functions/*` are served as edge
functions automatically. Recommended Pages build command: `node scripts/build-manifest.mjs` (keeps
the cache-busting manifest fresh). The `.claude/` directory (local preview tooling) is git-ignored.

## License

**Proprietary — all rights reserved.** See [`LICENSE`](LICENSE). The source is published for
transparency and is viewable, but it is **not** licensed for copying, redistribution, modification,
or commercial/hosted reuse without written permission. Personal use of the hosted app is fine,
subject to the on-site [disclaimers and terms](legal.html).

> **Disclaimer.** Blotterbook is a trading journal and cost/tax estimation tool — **not a broker**,
> and not financial, investment, or tax advice. All figures are estimates; trading involves risk of
> loss. See [`legal.html`](legal.html).
