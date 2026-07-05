# CSV examples — real platform exports (PERMANENT reference)

Owner-supplied real export sets (2026-07-05, demo/paper accounts — no live account data) for the
adapter work: **A209** (NinjaTrader/Tradovate family), **A103** (beta-adapter verification), and
**F47** (batch upload + detection status). **Kept indefinitely by owner decision (2026-07-05)** as
the ground-truth reference for future adapter/format questions — fixtures in
`scripts/test-adapters.mjs` guard the shipped behavior, but these are the real files behind them.

## What's here

| Folder | Files | Notes |
| --- | --- | --- |
| `ninjatrader/` | Performance, Fills, Orders, Cash History, Account Balance History, Position History | NinjaTrader (web) full export set |
| `tradovate/` | same six types | Tradovate full export set |
| `tradingview/` | order-history, balance-history, orders, positions, trading-journal (paper trading) | Both trade-bearing types already verified (A106/A219) |

## Key findings (2026-07-05 analysis)

1. **NinjaTrader ≡ Tradovate.** All six export types are byte-identical formats (same headers,
   same conventions) — NinjaTrader runs on the Tradovate platform. One adapter family covers both,
   and **headers cannot distinguish the platforms**; label the family "Tradovate / NinjaTrader"
   (matches the `brokers.json` broker name).
2. **The existing beta `tradovate` adapter already parses both platforms' `Orders.csv` to the
   cent** against the platform's own `Performance.csv` ground truth: Tradovate 9 round trips net
   −$13.75 ✓; NinjaTrader 2 round trips net +$325.00 ✓ (sides, qty, entry/exit times, holdMs all
   populated). That is the A103 verification bar for Tradovate.
3. **Per-type triage** (the F47 classification):
   - `Performance.csv` — authoritative paired round trips (symbol, qty, buy/sell price, `$x.xx`
     pnl, bought/sold timestamps, duration). Best single import source; **refused today**.
   - `Fills.csv` — per-fill rows **with real `commission` (1.29/fill for ES — matches the
     `brokers.json` TRADOVATE std 1.29/side)** → the A208 real-commission pipeline; refused today.
   - `Orders.csv` — detected + parsed today (avg-fill-price based, FIFO-paired; no commission
     column, so real costs are lost through this path).
   - `Cash History.csv` — funding + per-contract Exchange Fee / commission cash lines; not trades
     (recognized-non-trade for F47; possible future fee-enrichment source).
   - `Account Balance History.csv` — daily balance + realized PnL only (too coarse; skip).
   - `Position History.csv` — paired trades w/ Pair IDs (subset of Performance; skip or reconcile).
4. **Contract codes** are full expiry-coded symbols (`ESU6`, `MESM6`) → feeds A137a expiry capture.
5. **TradingView extras:** `orders`/`positions` exports were empty files; `trading-journal` is a
   text log (recognized-non-trade). Both trade-bearing TV types parse with the shipped adapters.
6. **Cross-export overlap:** Orders + Fills + Performance describe the SAME trades — the A219
   reconciliation model must extend to this family so a mixed batch never double-counts.
