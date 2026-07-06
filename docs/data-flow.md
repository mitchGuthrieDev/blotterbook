# Data flow & data management — the end-to-end prose overview (A110)

*2026-07-04. One narrative pass over how data moves through Blotterbook, stitching together what the
[architecture diagrams](architecture-diagrams/README.md) show piecewise — read this first, then the
diagrams for the boxes-and-arrows view ([csv-import-adapters](architecture-diagrams/csv-import-adapters.md),
[compute-costmodel-render](architecture-diagrams/compute-costmodel-render.md),
[storage-and-mode-separation](architecture-diagrams/storage-and-mode-separation.md)). Current as of
the CSV/data-management plan Phases 1–3 (intake hardening A177/A178, per-file provenance F37, real
commissions A208, effective-dated rates F30).*

## The one-paragraph version

A CSV never leaves the browser. It's validated, sniffed to a platform adapter, normalized into the
internal trade shape, delta-merged into IndexedDB **with its source file stored alongside**, and
from there every view is a pure recomputation: reference data (broker/fee/tax JSON) + the active
trade set → `applyFilters` → `compute()` → `costModel()` → Svelte renders. There is no server-side
state anywhere in this path — the Cloudflare Functions handle keys/flags/geo/payments scaffolding,
never trade data.

## 1 · Intake (A177/A178)

Every CSV enters through one of two intake points — the CSV Library upload zone/picker or the
first-run Onboarding dropzone (both now accept a **batch** of files in one action, F47) — and both
run the same two-stage gate from [`src/lib/core/intake.ts`](../src/lib/core/intake.ts) **before**
parsing:

- `checkCsvFile` (pre-read): extension/MIME allowlist (`.csv/.txt/.tsv` or `text/*`) + a 20 MB size
  cap — an oversized or wrong-type file is refused before it's ever read into memory.
- `checkCsvText` (post-read): binary sniff (NUL bytes / control-char density) + a 250k row cap.
  This one also runs *inside* `Adapters.parse` as belt-and-braces, so any future intake path is
  covered regardless.
- **The ATAS X `.xlsx` exception (F52):** a file `isXlsxFile()` recognizes is routed through
  `atasXlsxToCsv()` (`src/lib/core/xlsx.ts` — a dependency-free ZIP/OOXML reader scoped to ATAS's
  Journal sheet) *before* the text gates; the resulting CSV text then runs through `checkCsvText` +
  `Adapters.parse` exactly like any other import. The normal binary-sniff rejection of a raw `.xlsx`
  (a ZIP container) is not weakened — this is an explicit, narrow allowlisted route, not a bypass.
- **Cross-export reconciliation (A219):** after parsing, `reconcileImport()` (also in `intake.ts`)
  compares an incoming import against same-platform-family trades already in the store so a
  fills-derived round trip that a same-family *closed* export proves never happened (or vice versa)
  is dropped rather than silently double-counted — see the file's header comment for the full
  authority/derived-peer model.

## 2 · Detection + normalization (`src/lib/core/adapters.ts`)

`Adapters.detect` runs every platform adapter's `sniff` over the parsed header and takes the best
score **at or above that adapter's `minScore`** (the A178 strict gate) — a weak partial match
refuses with an error naming the supported platforms rather than misparsing. `Adapters.parse` then
calls the winning adapter's `toTrades`, which normalizes to the internal shape:

```
{ time, date, pnl, symbol, root, side [, qty, entryTime, exitTime, holdMs, commission] }
```

Two export styles exist: **closed** (each row is a finished position with realized PnL —
TradingView balance history, MotiveWave) and **fills** (individual executions — everything else),
where `pairFills()` runs a FIFO round-trip matcher that handles partials and flips, apportions
broker-reported realized PnL cent-exactly, and — when the export carries per-fill commissions
(A208, e.g. IBKR's `IBCommission`) — attributes entry+exit commission shares onto each closed
round trip as `Trade.commission`.

What is **transformed**: dates/times to canonical `YYYY-MM-DD HH:MM:SS` (with whole-file M/D/Y vs
D/M/Y detection), symbols through `rootSym()` (sanitized charset — also an XSS guard), numbers
through locale-aware `num()`. What is **kept raw**: since F37, the original CSV text itself is
persisted verbatim (next section) — the parse is repeatable.

## 3 · Persistence — the Store seam (`src/lib/core/store.ts`)

All persistence goes through the `Store` interface (guardrail A4): components never touch
`indexedDB` directly, so a future `CloudStore` can drop in behind the same async methods. The
IndexedDB database (v3) holds six object stores:

| store | keyed by | holds |
|---|---|---|
| `trades` | `tradeId` (content hash) | normalized trades (+ `fileIds`, `commission`) |
| `journal` | date | day notes `{text, tags, shots}` |
| `trademeta` | trade id | per-trade tags/note/screenshots |
| `meta` | key | setup, saved filters, migration flags |
| `files` | file id (content hash) | imported-CSV metadata records (F37) |
| `filetext` | file id | the raw CSV text, stored verbatim (F37) |

**Identity & dedupe.** `tradeId` is an FNV-1a hash of `time|symbol|side|pnl` (+ a within-file
ordinal for genuinely-identical same-second trades — A114). Provenance (`fileIds`) and real
commissions are deliberately *excluded* from the hash, so re-importing an overlapping export
dedupes: `addTrades` counts it a duplicate and **merges** the new file's id into the existing
trade's `fileIds` array. Editing a trade is delete-old + add-new (the id is content-derived), with
tags/notes migrated to the new id.

**Per-file provenance (F37).** Each import stores a file record (name, platform, counts, coverage,
overlap, included flag) plus the raw text — metadata and text split into separate stores so listing
the library never loads megabytes. The Library's include/exclude toggle filters the **active
dataset** at load time (a trade stays visible if *any* contributing file is included; pre-F37
trades with no `fileIds` are always included); deleting a file removes only trades no other file
contributed. Raw-text storage has a soft 50 MB budget (warning from 80%).

**Backup/restore.** `exportAll` is a full JSON snapshot (trades, journal, meta, trademeta, files +
raw texts). `importAll` is a trust boundary: everything is re-sanitized on the way in (dates/times
re-validated, roots re-sanitized, tags canonicalized, screenshot data-URIs allow-listed, meta keys
allow-listed, file ids shape-checked and texts re-run through the intake gate).

## 4 · Reference data (`loadRefData`)

`/data/manifest.json` (no-cache) maps each reference file to a content hash; the files are then
fetched as `?v=<hash>` — cacheable forever, updated the instant the bytes change. `brokers.json`
(per-side commission tiers + optional effective-dated `rateHistory`) and `exchange-fees.json`
(per-root exchange+clearing+NFA composites + effective-dated `history`) feed the cost model —
since F30, `rateFor(broker, root, date)` prices each trade at the rate effective on *its own*
date. `feeds.json` supplies data-feed pricing and `state-tax.json` the §1256 model. All of it is
data-only: a rate change is a JSON edit + `build-manifest.mjs`, no app code.

## 5 · Recompute — pure and total (`compute` / `costModel` / `curveseries`)

The reactive chain in the Svelte app (`createDashboard` in
[`src/app/lib/dashboard.svelte.ts`](../src/app/lib/dashboard.svelte.ts)) is: active trade set →
`applyFilters` (date/root/side/session/tag/day-of-week) → `compute()` (PnL, win rate, drawdown,
curve, expectancy, streaks, Sharpe/Sortino…) → `costModel()` (commissions — a trade's real CSV
commission verbatim when present (A208), else the dated modeled rate (F30); subscriptions accrued
over the elapsed span; §1256 tax; take-home) → the screens render from `$derived` state. Nothing
along this chain mutates anything: every change to filters, setup, or data re-derives the whole
picture, and `curveseries` applies the identical commission rules so the equity-curve endpoint
always reconciles with the cost panel.

## 6 · Modes — one app, three storage behaviors

`main.ts` mounts the same `App.svelte` everywhere; `PAGE_MODE` (from `<body data-mode>`) picks the
`Store` instance, which `App.svelte` then prop-drills into the rune-module factories and down through
screens/parts (no `context()` seam):

- **app** — real IndexedDB (`blotterbook`), no seeding; empty → onboarding.
- **staging** — real IndexedDB, **isolated** database (`blotterbookStaging`), seeded.
- **demo** — the in-memory `DemoStore` ([`demostore.ts`](../src/lib/core/demostore.ts)): identical
  interface backed by Maps, so *nothing can reach disk by construction*; on top, every write path
  is `isDemo`-guarded and write controls are disabled (belt and suspenders — e2e asserts no
  Blotterbook IndexedDB exists on demo).

## 7 · The guarantee

Trade data lives in exactly two places: the user's IndexedDB and the user's own backup downloads.
The only network calls in the data path are same-origin fetches of static reference JSON; the edge
functions (`/api/*`) see keys, flags, and coarse geo — never a trade. That's the moat, and every
layer above is designed so it stays true mechanically (Store seam, DemoStore-by-construction,
client-side-only validation), not by policy.
