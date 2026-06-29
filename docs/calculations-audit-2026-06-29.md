# Calculations correctness audit — 2026-06-29 (A66, P1)

Exhaustive, **read-only** correctness audit of every calculation Blotterbook performs on
imported data — the platform's core value. Covers the pure-logic core (A29): `adapters.ts`
(CSV parse, `pairFills()`, normalization), `core.ts` `compute()` (metrics) + `costModel()`
(commissions/fees/subscriptions/Section-1256 tax/take-home), `curveseries.ts` (gross/net/take
series), and `report.ts` (report assembly). Each discrepancy is filed as a backlog fix item
(**A113–A120**); per A66 nothing is fixed inline.

> **Update (same day):** all eight follow-ups (**A113–A120**) have since been implemented and shipped —
> see their `doneNote`s in `data/backlog_archive.json`. The behavior change worth flagging is **A117**:
> fixed subscriptions now accrue over the **elapsed month span** (gap months billed), not only active
> months. The cost panel and the equity curve were updated in lockstep so they still reconcile.

## Headline

**The core math is fundamentally sound.** I traced every metric and cost line against
hand-worked examples and edge cases and found **no errors in the aggregate totals** that the
product leads with — net P&L, win rate, profit factor, expectancy, drawdown, the cost/tax
breakdown, and the curve endpoints all reconcile, and the curve/cost/report surfaces are
single-sourced so they cannot drift from each other. The ordering invariant the equity curve
depends on holds: both `Store.getAllTrades()` and `DemoStore.getAllTrades()` sort by `time`
before `compute()` sees the data, and `applyFilters()` preserves order.

The actionable findings are **two genuine, silent data-correctness risks** (P2) plus a set of
P3 accuracy/modeling/edge items. None corrupt the headline totals for the common case; the P2s
matter because they fail **silently** for specific data shapes.

## Prioritized findings (filed)

| Sev | Finding | File · location | Filed |
| --- | --- | --- | --- |
| **P2** | **Unknown futures point-value silently computes wrong PnL.** `pointValue()` returns **1** for any root not in the ~60-entry `POINT` table. For *fills* exports without a `realized` column (Tradovate / Rithmic / Sierra Chart / TradeStation — all price-derived), PnL = `(exit−entry) × qty × pointValue`, so an unlisted contract (e.g. SOFR `SR3`, `VX`, or any newer root) is priced at **$1/point** — wildly wrong — with **no warning**. Mirror the commission `known` flag: detect unknown-point roots, surface a per-symbol warning, and consider blocking the import. | `adapters.ts:236` `pointValue`; consumed `adapters.ts:289` | **A113** |
| **P2** | **Dedupe key collapses genuinely distinct same-second trades.** `tradeId = time\|symbol\|side\|pnl` (`store.ts:88`). The intent is re-upload overlap dedupe, but the key omits `qty`/`price`/`entryTime`, and a normalized TradingView closed-event trade carries *none* of those. Two real 1-lot scalps on the same symbol/side closed in the same second with the same realized PnL (plausible for active scalpers) hash identically → the second is dropped → **every metric understates silently**. Widen the key (entry/exit time, qty, or a stable per-row ordinal) at least for close-event exports. | `store.ts:88` `tradeId` | **A114** |
| P3 | **Multi-lot `realized` apportioned by qty, not price.** In `pairFills()`, when one closing fill carries a single `realized` and closes lots opened at different prices, PnL is split pro-rata by matched qty (`f.realized * m/closeQty`), not by each lot's true price spread. **Totals are exact**; only the per-trade split is approximate, so best/worst-trade, per-trade std dev, and marginal win/loss counts can be slightly off. | `adapters.ts:288` | **A115** |
| P3 | **B13 negative-clamp not mirrored in the curve.** `costModel()` clamps platform/feed to ≥0 (`Math.max(0,…)`, B13) but `EquityCurve.build()` computes `fixedMo` as `(platform‖0)+(feedCost‖0)` with no clamp. A negative cost input makes the curve's net/take endpoint disagree with the cost panel. Low impact (inputs are `min=0`), but the two should clamp identically. | `EquityCurve.svelte:101` vs `core.ts:474` | **A116** |
| P3 | **Subscriptions accrue only on *active* months.** `fixedPeriod = fixedMo × monthsWithTrades` (both `costModel()` and `dailySeries()`); a trader who skips a calendar month still pays the subscription, so fixed cost is under-modeled across gaps. Internally consistent (cost panel ↔ curve agree), so this is a **modeling decision to confirm**, not a drift bug — elapsed-span vs active-months. | `core.ts:499`, `curveseries.ts:42` | **A117** |
| P3 | **Calc edge cases under-tested.** `test-adapters.mjs` has no fixture for: an unknown-point root (A113), a same-second dedupe collision (A114), multi-lot `realized` apportionment (A115), `qty>1` round-turn commission in `costModel` (flagged in A98 too), or a DST-crossing `holdMs`. Add cases so these paths are guarded. | `scripts/test-adapters.mjs` | **A118** |
| P3 | **Cost modeling assumptions are unstated to users.** (a) `costModel` assumes the export's PnL is **gross** of commission; if a platform's realized PnL is already net (e.g. TradingView with commissions configured), modeled commissions **double-count**. (b) TradingView/closed-event exports carry **no qty**, so a 5-lot position's round-turn commission is modeled as **1 contract** (`q = t.qty‖1`), under-stating cost. Both are inherent to the data — surface them in the cost panel / report footnote. | `core.ts:486`, `core.ts:502` | **A119** |
| P3 | **Minor numeric edge cases (bundled).** (a) `holdMs` via `tms()` uses local `Date`, so an entry→exit span crossing a DST change is off by the offset (~1h); informational field, low impact. (b) `normTime()`'s exotic-format fallback (`new Date(str)` + local getters) is timezone-dependent, so the same CSV can normalize differently across users for unrecognized formats. (c) `compute().net` and the curve series accumulate raw floats without rounding to cents, so sub-cent drift propagates into the tax base before display rounding. | `adapters.ts:170,165`; `core.ts:91` | **A120** |

## Path-by-path notes (what was verified)

### `adapters.ts` — parse / normalize / `pairFills`
- **`parseCSV`** — quote-aware, comma/tab auto-detect from the first line, escaped `""`, embedded
  newlines inside quotes, and all-empty-line dropping all behave correctly.
- **`num()`** — US/EU separator disambiguation is correct across the tested matrix (`$1,234.50`,
  `1.234,50`, `123,45`, `1,234`, accounting parens, multi-group). The one ambiguity (a genuine EU
  3-decimal `0,123` read as thousands `123`) is **documented** (B24/B42) and acceptable for
  futures PnL/prices. No change recommended.
- **`rootSym()`** — month/year-code stripping, exchange-prefix and `/`/`1!` handling, and the safe
  charset filter all check out; `M2K`/`M6E`/`6E` roots survive correctly (no over-stripping).
- **`normTime()` / `DATE_ORDER`** — ISO and slash formats, AM/PM, 2-digit years, and the
  whole-file M/D/Y vs D/M/Y decision (B26) are correct. Edge: the `new Date(str)` fallback for
  unrecognized formats is local-tz-dependent → **A120**.
- **`pairFills()`** — FIFO matching, flip handling (close-then-open), partial fills, the
  same-second newest-first `_seq` tiebreak (B25), and `realized`-vs-price PnL selection are all
  correct; flip fills attribute their **full** realized PnL to the closed contract (not diluted).
  Two gaps: unknown point value (**A113**) and multi-lot realized apportionment (**A115**).

### `core.ts` — `compute()`
- Net, gross profit/loss, win/loss/scratch (strict `>0/<0/===0`), win rate (scratches in the
  denominator — standard), profit factor, avg win/loss, win/loss ratio: **correct**.
- Equity curve + **realized** max drawdown (running peak, $ and peak-relative %, duration, and the
  curve indices for the DD card) reconcile against a hand-walked series; the `maxDDpct = 0 when the
  peak never went positive` case is intentional and documented.
- Streaks (consecutive W/L counts **and** $), profit concentration (top-5 / net), day/weekday
  buckets (local-midnight weekday — stable), Sharpe/Sortino (population, daily, not annualized —
  documented), expectancy, per-trade std dev, long/short split, best/worst day & weekday, recovery
  factor: **all correct**. Spread-free running min/max avoids the large-array stack overflow (B27).
- Empty-input is handled without throwing (Infinity/NaN are absorbed by the formatters).

### `core.ts` — `costModel()` + reference data
- Round-turn commission `rate × 2 × (qty‖1)` per contract, per-symbol rollup, all-in rate =
  broker tier + exchange/clearing/NFA (with the micro/std tier heuristic and `EXCH_FALLBACK`),
  fixed subscriptions, Section-1256 blended federal rate (60/40 weights, normalized if the JSON
  drifts — B8) + state top rate, tax on **positive** net only, after-tax take-home, break-even
  per trade: **all correct and internally consistent**.
- `tierOf()`/`exchOf()` fallbacks and the `M`-prefix micro heuristic are reasonable for unknown
  roots. `data/state-tax.json`, `brokers.json`, `exchange-fees.json` values are coherent and the
  `test-tax.mjs` literal-vs-JSON guard is in place.
- Modeling assumptions (gross PnL; no-qty close events; active-months subscriptions) → **A117/A119**.

### `curveseries.ts` + `report.ts`
- `dailySeries()` net/take endpoints reconcile **exactly** with `costModel.netPreTax`/`afterTax`
  given the same broker / `tEff` / `fixedMo`; the per-month subscription accrual matches
  `fixedPeriod`. The App passes consistent `tEff = blendedRateFor(stateRate)` and matching
  `fixedMo` to both — except the unclamped `fixedMo` (**A116**).
- `buildReport()` / `reportHtmlDoc()` are pure formatting/assembly over the verified metrics; the
  on-screen, Markdown, and email outputs are single-sourced and color tones mirror correctly. No
  numeric issues. (Note: `curveseries`/`report` lack node unit coverage — already filed as **A98**.)

## Verification method

Findings were derived by reading the source directly and hand-working representative and
boundary cases (empty/partial fills, same-symbol reversals/flips, multi-contract, fractional/large
qty, missing fields, DST/year boundaries, float accumulation, negative/zero PnL, micros vs minis,
per-state tax). The two P2 risks were each re-checked end-to-end through the import → store →
`compute`/`costModel` pipeline to confirm they survive (no upstream layer disambiguates the dedupe
key; no layer flags an unknown point value).
