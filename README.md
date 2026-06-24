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
calls are loading the app's own reference-data JSON and an optional PayPal donate button.

> **Design pillars (intentional constraints):** compute happens locally, there are **no runtime
> dependencies**, and the whole thing deploys as static files to **Cloudflare Pages**. The app
> *is* split across files (it used to be one `index.html`), so it must be **served over http(s)** —
> opening it from disk will block the `fetch()` of the reference data.

## Table of contents

- [Project layout](#project-layout)
- [Marketing homepage](#marketing-homepage) — the one-page site at `/`
- [Quick start](#quick-start)
- [Input: the CSV](#input-the-csv) — and how re-uploads merge
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
/                       one-page marketing homepage (index.html) → links to /app
  index.html            hero + features + use cases + pricing + FAQ (single scroll, anchor nav)
  changelog.html        "Blotterlog" — change history styled to match the homepage
/app/                   the journal app
  index.html            app markup (links app.css + app.js)
  demo.html             the demo on its own page (shares app.css/app.js; opens in a new tab)
  app.css               all app styles (shared by index.html and demo.html)
  app.js                the main app script (shared; mode-aware via body[data-mode])
  store.js              IndexedDB persistence (swappable storage interface)
  entitlements.js       storage-tier resolver (scaffold; always "local" today)
/data/                  reference data, fetched at runtime
  brokers.json          broker commission tiers
  exchange-fees.json    CME exchange/clearing/NFA fees + micro set
  feeds.json            per-broker market-data feed options
  state-tax.json        Section 1256 model + per-state top rates
  manifest.json         content hashes for cache-busting (generated)
/functions/             Cloudflare Pages Functions (Stripe/accounts scaffold)
  api/{me,checkout,webhook}.js
  README.md             accounts/payments/storage-tier plan
/scripts/
  build-manifest.mjs    regenerates data/manifest.json (Node built-ins only)
/assets/banner.svg
```

## Marketing homepage

The site root (`index.html`) is a **single-page, scrollable marketing site** for Blotterbook,
styled with the same dark palette and tokens as the app. A minimalist sticky header carries
anchor links that smooth-scroll to each full-height section:

| Section | Purpose |
| --- | --- |
| **Home** | The hero (banner, tagline) with **Launch Blotterbook** and **See Demo** CTAs, plus a **Live** status pill that pings `/app/` and reports whether the app is responding. |
| **Features** | A three-column grid of the app's capabilities (privacy, cost model, tax, broker comparison, curve/calendar, stats). |
| **Use Cases** | The pitch — Blotterbook as both a profit/budgeting calculator and a private journal (broker comparison, tax planning, break-even, review). |
| **Pricing** | Two cards: **Blotterbook — Free** (donations welcome, PayPal button) and a greyed-out, planned **Online app (~$49/mo)** that would connect directly to brokers and trading platforms. The current CSV-driven app stays free. |
| **FAQ** | Expandable (collapsed-by-default) questions covering supported data, cost/tax modeling, and limitations — a friendlier take on this README. |

`changelog.html` ("**Blotterlog**") is a standalone, matching-styled page linked from the header
and footer. It pulls the **live commit history from the GitHub API** on each load (newest first,
with links to each commit) and falls back to a baked-in snapshot if the API is unreachable. Both
pages are static with no build step (the donate button and the GitHub fetch are the only external
calls).

## Quick start

1. Serve the folder over http (see [Development](#development--deployment)) and open `/app/`.
   The homepage at `/` links to it (**Launch Blotterbook**).
2. In the centered **Broker & Costs** panel, choose your **Broker**, **Data feed**, and **State**,
   and set the monthly **Platform fee**. (Load CSV is disabled until all three are chosen.)
3. In TradingView, export your account balance history as CSV.
4. Click **Load CSV** and select the file. Your data is saved locally — it's restored
   automatically next time you open the app. Load more CSVs later from **Manage data → Load CSV**.

Prefer to look around first? Open **See Demo** on the homepage for a generated, profitable sample
month (not saved). To erase your data, use **Manage data → Erase all local data**.

## Input: the CSV

The parser expects a TradingView balance-history export. Required columns (matched
case-insensitively by substring): **`Time`**, **`Realized PnL (value)`** (falls back to
`Realized PnL`), and **`Action`**. The parser is quote-aware because `Action` contains commas
inside quotes.

Each CSV **row is one trade** — a position-*close* event with its own realized PnL. The
instrument is parsed from the `Action` text (`... for symbol MESM2025 at price ...`) and reduced
to a **root ticker** (`MESM2025` → `MES`, `MES1!` → `MES`, `M2KZ2025` → `M2K`).

```
Time,Action,Realized PnL (value)
2026-06-02 10:00:00,"Close long position for symbol MESM2025 at price 5300.00",75.00
```

**Re-uploads merge.** Each trade gets a stable id from its `time + symbol + side + pnl`. Uploading
a CSV that overlaps a previous one only inserts the genuinely new rows, so you can export a wider
window each time without creating duplicates. The data summary shows `+N new · M dup`.

## UI walkthrough

| Section | What it shows |
| --- | --- |
| **Top bar** | The **Blotterbook** wordmark (links to the homepage) and the loaded-source text — once data is loaded, clicking it opens **Manage data** (it does nothing before load); it's truncated so long filenames don't bloat the bar. Actions: **Changelog**, **Export report**, **Manage data**, Contact. |
| **Landing (no data)** | The intro text and the **Broker & Costs** module sit together, centered as a group in the viewport (like the homepage hero), until data loads. |
| **Broker & Costs** | Broker / data feed / platform fee / state. Collapsible once loaded; selections persist. |
| **Scope toggle** | Switches most views between *All time* and the *Selected month*. |
| **Filters** | Date range, symbol, side, session (RTH/ETH), and day-of-week. Applies before everything. |
| **Stat cards** | Net PnL (+ take-home), win rate, profit factor, avg win/loss, max drawdown. |
| **Performance** | Cumulative PnL vs. date, with stepped y-axis gridlines and a gradient area fill. Click the **Gross / Net / Take-home** buttons to toggle overlays (highlighted when active; at least one always stays on); hover for values; click a calendar day to mark it. |
| **Trading Calendar** | Sunday-first month grid of daily PnL with weekly summaries; **day-notes** below. |
| **Break-even & Cost Budget** | Per-symbol commission table and a full-width itemized waterfall — gross, commissions, subscriptions, net pre-tax, the folded-in **Section 1256** tax detail, take-home, and break-even/trade. |
| **Advanced Statistics** | Daily averages, expectancy, long/short split, best/worst day & weekday, Sharpe, streaks. |
| **Definitions & Caveats** | How each number is computed and where the data falls short. |

**Demo (its own page).** The demo lives at `app/demo.html` and is reached from the homepage
(**See Demo**), not the app. It's the full app on a generated, profitable month of sample data,
minus the Load CSV / Manage data controls; an **End demo** button returns to the homepage (closing
the tab when the browser allows). The header shows a purple **DEMO** badge. Demo data is in-memory
only and never persists.

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
Charles Schwab (thinkorswim), Interactive Brokers, TradeStation.**

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

- **Overview** — trade count, date range, day-note count, and the approximate on-disk size.
- **Load data** — *Load CSV* lives here now (moved out of the top bar). Imports merge — only new
  trades are added. The first load is still done from the centered Broker & Costs panel on the landing.
- **Backup &amp; restore** — *Download backup (.json)* writes a single file with your trades, day-notes,
  and setup (`Store.exportAll()`); *Restore from backup* merges one back in (`Store.importAll()`).
  Restores de-duplicate by the same stable trade id, so re-importing is always safe. This is the
  answer to "local storage is per-browser" — a portable snapshot you control.
- **Day notes** — every dated note, each with a delete button.
- **Trades** — a searchable (symbol / date / side), scrollable table with per-row delete. Deletions
  apply immediately across every view and recompute metrics live.
- **Danger zone** — *Erase all local data* (`Store.purge()`), behind a confirm. (This replaced the
  old top-bar Clear data button.)

Each section renders independently (wrapped in try/catch), so a single failure can't blank the rest.

The `Store` interface stays the single source of truth — the manager added `deleteTrade`,
`getAllJournal`, `deleteJournal`, `getAllMeta`, `exportAll`, and `importAll` to it, so a future cloud
backend gets the same management UI for free.

## Filters & journal

**Filters** (apply before scope, cards, graph, calendar, cost, and stats):

- **Date range**, **Symbol** (root), **Side** (long/short).
- **Session** — RTH (09:30–16:00) vs. ETH, by the timestamp's clock time as exported.
- **Day of week** — toggle any subset of S M T W T F S.
- A live `N / M trades` count and a **Reset filters** button.

**Day-notes / journal:** click any calendar day to open a notes editor for that date. Notes
auto-save to IndexedDB; days with a note get a small dot on the calendar. (Disabled for demo data.)

## Architecture

The data flow is linear and entirely client-side:

```
loadRefData()   manifest.json → brokers/exchange-fees/feeds/state-tax (cache-busted by hash)
CSV text
  → parseCSV()      quote-aware splitter → rows
  → toTrades()      rows → [{time,date,pnl,symbol,root,side}] (chronological)
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

**The current app — CSV-driven and Cloudflare-hosted — is free and stays free.** It's supported by
optional donations (the PayPal button). There is **no one-time/local desktop app** planned; the
hosted platform is the product.

The only planned paid tier is a future **online app (~$49/mo)** that would connect **directly to
brokers and trading platforms** for data instead of importing CSVs. It's not built; pricing is
indicative.

| Tier | Bought via | Storage / data | Status |
| --- | --- | --- | --- |
| Free | donations | IndexedDB (this browser), CSV import | shipped |
| Online (direct-connect) | subscription (~$49/mo) | server-side + live broker/platform feeds | planned |

`/functions/api/{me,checkout,webhook}.js` are stubbed Cloudflare Pages Functions for Stripe
checkout, webhook-driven account provisioning, and tier lookup. `app/entitlements.js` is the client
resolver that will pick the matching `Store` implementation; today it always returns `local`.

## Roadmap

Discussed / planned, roughly in order:

- **Platform-agnostic CSV parsing** — support broker exports beyond TradingView (normalize varied
  column names, symbol formats, and row semantics into the same trade shape).
- **Stripe integration** — finish the checkout / webhook / entitlements flow scaffolded in
  `/functions` so the online tier can be sold.
- **Accounts + cloud sync** — a `CloudStore` implementing the same `Store` interface for
  cross-device data (the current per-browser limitation).
- **Direct broker / platform connections** — pull fills, commissions, and rates live (the basis of
  the planned online tier), removing the CSV step.
- **Reference-data upkeep** — keep `data/*.json` (broker/fee/feed/state) current; consider sourcing
  some rates dynamically.
- **Deeper analytics** — open-position drawdown (needs entry/exit pairing), holding-time stats,
  per-strategy tagging, and richer report exports.

## Known limitations

- **Drawdown is realized only** — from the closed-trade curve; no open-position heat.
- **No trade length** — the export has close timestamps only, so holding time isn't derivable.
- **Commissions are modeled** — raw PnL is gross; rates come from the editable JSON and may drift.
- **Calendar-day & session grouping** — both use the literal `Time` value, not the CME session day;
  RTH/ETH assumes the timestamp's clock time.
- **Sharpe is illustrative** — daily PnL, population std, not annualized.
- **Local storage is per-browser** — data is not synced across devices and is cleared if you clear
  site data. Use **Manage data → Download backup** for a portable JSON snapshot in the meantime.
  (Cloud sync is the planned subscription tier.)

## Privacy

All parsing, computation, and storage happen locally in your browser; trade data is never
uploaded. The only network calls are the app's own `/data/*.json` and the optional PayPal donate
button.

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

No license specified. All rights reserved by the author unless stated otherwise.
