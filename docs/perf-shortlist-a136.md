# Performance optimization shortlist (A136)

**Date:** 2026-07-05 · **Item:** A136 (DISCUSSION/EVALUATION) · **Build measured:** local `npm run build`,
size gate reports **619.4 KiB / 640 KiB** (20.6 KiB headroom); boot (static) chunks ≈ **451.5 KiB**, lazy
screen chunks ≈ **167.9 KiB**.

## Prioritized shortlist

| # | Change | Expected win | Effort | Risk | Fits 640 KiB gate? |
|---|--------|--------------|--------|------|--------------------|
| 1 | `$state.raw` for `allTrades` (dashboard.svelte.ts) | Large on big sets — removes deep-proxy overhead from ~20 O(n) passes per recompute | S | Low-Med (audit mutation paths; all writes already replace the array wholesale) | Yes (size-neutral) |
| 2 | Downsample per-trade SVG paths (Analytics underwater curve + `curve` prop) to ≤ ~1–2k points | Large render win on fills imports (today: one path command per trade) | S | Low | Yes (size-neutral) |
| 3 | Parallelize `reloadAll()` store reads + drop the redundant `journalDates()` read | Boot latency: 6 sequential IndexedDB round trips → ~1; one fewer journal-store scan | S | Low | Yes |
| 4 | Targeted refresh instead of full `reloadAll()` for meta-only writes | Avoids re-reading + re-sorting the entire trades store on every tag/note/rename | M | Med (two code paths must stay consistent) | Yes |
| 5 | Batch `deleteTrades()` into one readwrite tx | Bulk delete goes from 2 txs/trade to 1 total | S-M | Low | Yes |
| 6 | compute() constant-factor pass: memoize date→weekday, fold redundant passes | Modest; only visible at very large N | S-M | Low (node-tested core) | Yes |
| 7 | Lazy-load `Adapters` out of the boot chunk | ~25–30 KiB less boot parse/exec; **gate-neutral** (gate sums lazy chunks too) | M | Low-Med | Yes (no change to total) |
| — | Geist Mono subsetting | **Drop** — already latin-subset at 22.6 KiB, and fonts aren't in the JS gate | — | — | n/a |
| — | Trim the bits-ui select chunk / tailwind-merge | **Decline** — intentional ADR-002 weight (see Bundle) | L | High | — |

Recommended to adopt now: **1, 2, 3** (small, low-risk, big at scale). Adopt **4/5** with the next
data-management touch. **6/7** only if profiling on a 100k-trade fixture shows they matter.

## Bundle size

Current chunk graph (`scripts/check-bundle-size.mjs`, uncompressed): boot = `select` 160.7 KiB
(bits-ui Select/menus + Floating UI — `clippingAncestors` — + tailwind-merge class map), `main`
137.0 KiB (app code: App.svelte + Dashboard + shell + core + adapters), `disclose-version` 57.7 KiB
(Svelte runtime), `textarea` 57.1 KiB (shared bits-ui internals), plus badge/input/card/core/intake/
format ≈ 39 KiB. Lazy: 6 screens + on-demand primitives ≈ 167.9 KiB.

- The old "utils (~124 KiB)" chunk no longer exists as such — its weight (tailwind-merge, bits-ui
  shared code) now lives inside the `select`/`textarea` chunks. It is reachable at boot because the
  Dashboard (the static boot screen) legitimately uses Popover/Select/DropdownMenu/Dialog.
- **No adoptable dep removal found.** The heavy chunks are the ADR-002 primitives (an approved,
  deliberate reversal of "keep it lean") and product code; lucide icons are tree-shaken (per-icon
  450 B lazy chunks prove it). Replacing tailwind-merge or hand-trimming bits-ui is L effort / high
  regression risk for ~20–40 KiB — decline.
- The only honest *gate* reductions left are byte removals; everything else (7 above, further
  code-splitting) improves first-paint latency but not the gate total, since A190 made the gate sum
  the whole chunk graph.

## compute() / costModel() on large N

`compute()` (src/lib/core/core.ts:136) is ~20 O(n) array passes (3 filters, ~8 reduces, curve walk,
streaks, side() ×2 = 6 passes, dayMap, dowBuckets) + a `new Date()` **per trade** in `dowBuckets`.
`costModel()`, `dailySeries()` and the Blotter/Editor `rowBase` each add one O(n) pass with a
per-trade `rateFor()` (cheap: Map/Set lookups + a short history scan). All fine at 10k trades;
at 100k the dominant cost is not the algorithm but **Svelte's deep-reactivity proxy**: `allTrades`
is deep `$state`, so every `t.pnl`/`t.date` read in every pass goes through the proxy — millions of
proxied reads per recompute (every filter keystroke). Since every mutation path already replaces
`allTrades` wholesale via `reloadAll()`, `$state.raw` is the designed escape hatch (item 1). After
that, item 6 (cache weekday per unique date — dates repeat heavily — and fold passes) is the next
constant-factor step. Full memoization machinery is **not** recommended: the `$derived` graph
already gives the right granularity — `blotterRows`/`editorRows`/`analytics`/`dashSeries` are lazy
deriveds in App.svelte, evaluated only when their screen actually renders. Debouncing the free-text
date filter inputs is a fallback if large-N profiling still shows keystroke jank.

## IndexedDB read patterns on boot

`boot()` → `reloadAll()` (src/app/lib/dashboard.svelte.ts:145) awaits **six reads sequentially**
(getFiles, getAllTrades, journalDates, getAllJournal, allTradeMeta, getMeta) — each its own
readonly tx, so `Promise.all` collapses the latency (item 3). `journalDates()` (getAllKeys) is
fully derivable from the `getAllJournal()` result — one redundant store scan. Bigger at scale:
`reloadAll()` also runs after **every** mutation, so saving one tag re-reads and re-sorts the whole
trades store (item 4 — `saveNote` already patches in memory and is the pattern to copy).
`deleteTrades()` awaits 2 txs per id in a loop (item 5). `importCsv` re-reads `getAllTrades()` for
reconciliation despite holding `allTrades` — acceptable (correctness: reads the persisted truth).

## Chart / curve render cost

The Dashboard performance chart is per-**day** points, and its `view` derived excludes the hover
`cursor` (hover doesn't rebuild paths) — no action needed. The **Analytics underwater curve**
(Analytics.svelte:174) and any consumer of `metricsActive.curve` build one SVG path command per
trade: a 100k-trade import yields a ~100k-command path in a 100×50 viewBox, far beyond visual
resolution — min/max decimation to ≤ ~1–2k points is lossless on screen (item 2).

## $effect audit

13 `$effect`s across src/app; all are small, event-wiring or guarded prop-reseeds (the A195
`lastModKey` guard already killed the one known redundant re-run). **No significant redundant
$effect work found** — nothing to adopt here.

## Budget recommendation

**Hold `BUDGET_BYTES` at 640 KiB.** None of the adopted items changes the gate total, remaining
weight is intentional (ADR-002 primitives + product code), and 20.6 KiB headroom still catches an
accidental heavy import. Do **not** ratchet back toward 600 speculatively; if a future change
genuinely removes bytes (a dep drop or primitive consolidation), re-ratchet then to
`current total + ~24 KiB` in the same PR, with the rationale in the check-bundle-size.mjs comment
block as usual.

## Proposed backlog items

- **A2xx — `$state.raw` for the trade dataset.** Switch `allTrades` (and `csvFiles`) in
  `dashboard.svelte.ts` to `$state.raw`; audit every mutation path still replaces wholesale
  (they do today — `reloadAll` reassigns); drop the now-unneeded `$state.snapshot` in
  `editTradeCore`. Perf: removes deep-proxy overhead from every compute()/costModel() pass.
  Verify with a 100k-trade fixture (filter keystroke + import timings before/after).
- **A2xx — Downsample per-trade chart paths.** Add a pure `decimate(vals, maxPoints)` (min/max per
  bucket) to core, node-tested; use it for the Analytics underwater curve and the `curve` prop so
  SVG paths are capped at ~1–2k points regardless of import size.
- **A2xx — Boot read consolidation.** `reloadAll()`: `Promise.all` the six store reads; derive
  `journalDates` from `getAllJournal()` and retire the extra `getAllKeys` scan. No behavior change;
  e2e stays green.
- **A2xx — Targeted post-mutation refresh + batched deletes.** Meta-only writes (saveTradeMeta,
  renameFile, setFileBroker, setFileIncluded) patch reactive state in place (the `saveNote`
  pattern) instead of full `reloadAll()`; add a `Store.deleteTrades(ids)` single-tx batch used by
  the Blotter/Editor bulk delete. Riskier — needs the demostore + store node suites extended.
