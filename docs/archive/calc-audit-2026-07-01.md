# Calculation-correctness audit — 2026-07-01 (A66)

Exhaustive **read-only** audit of every calculation Blotterbook performs on imported data (backlog
**A66**, P1): `adapters.ts` (parse/normalize/pairFills), `compute()` metrics, `costModel()` + rate
helpers + reference data, `curveseries.ts`, `report.ts`, and the app view-models
(`analytics.ts`/`reports.ts`/`dashboard.svelte.ts`) that shape those numbers for display. Four
auditors ran in parallel, one per layer; **every finding below was reproduced by executing the real
modules under node** (fetch stubbed to the committed `static/data/*.json`), and the coordinator
independently re-ran the P1s and the highest-severity P2s before filing. Per A66's charter **no
code was changed** — each discrepancy is filed as a fix item (**A168–A175**).

**Headline: the core math is sound; the edges are not.** The FIFO fills matcher and its
apportionment rules (A113/A114/A115/A120/B25), the commission/tax arithmetic, the gap-month
subscription accrual (which reconciles with `dailySeries` to 1e-9 including year wraps), Sharpe/
Sortino/drawdown/streaks on normal data, and the tokenizer's quote handling all re-derived
correctly by hand. The failures live in input tolerance, degenerate datasets, and
label-vs-basis consistency — **2 P1s, 11 P2s, ~20 P3s**.

## P1 — wrong numbers reach the user silently, in normal use

| # | Finding | Filed |
| --- | --- | --- |
| 1 | **A semicolon-delimited CSV imports "successfully" with `pnl = 2026` (the year) on every row.** `parseCSV` auto-detects only comma vs tab (`adapters.ts:28-32`), so a `;` file collapses each line into one cell; substring header sniffing still scores it as TradingView, all column indexes resolve to the same merged cell, and `num()` extracts the leading year as the P&L. Reproduced end-to-end: `ok:true, trades:[{pnl:2026,…},{pnl:2026,…}]`. Semicolon CSVs are exactly what an EU-locale Excel re-save produces. | **A168** |
| 2 | **"Compare to prior period" gains a day when the prior window crosses DST spring-forward.** `priorBounds` (`reports.ts:45-53`) does epoch-millisecond arithmetic on local midnights; the 23-hour day makes the window start land a day early. Reproduced under `TZ=America/New_York`: April's prior (should be Mar 2→31) includes Mar 1 — prior Trades 2 and prior Net +$1,000 instead of 1 / +$1. Correct under UTC and for fall-back. Every US-timezone user comparing a window whose prior crosses mid-March is affected. (Pass 4's "priorBounds is DST-safe" note verified only the day *count*; the start-date epoch math is the bug.) | **A169** |

## P2 — wrong numbers in edge cases real data can hit

| # | Finding | Filed |
| --- | --- | --- |
| 3 | `detectDateOrder` scans the **whole file text** — one `d/m/yyyy`-looking fragment in any note/description cell silently re-dates the entire import (verified: a stray "14/3/2026" flips 06/02 → Feb 6). | A168 |
| 4 | IBKR's quoted `"YYYY-MM-DD, HH:MM:SS"` datetime loses its time (`normTime` ISO branch lacks the comma separator) — every fill lands at midnight; hold time and session analytics silently wrong. | A168 |
| 5 | A blank/garbage fill timestamp either escapes as `holdMs: NaN` (renders "NaNm" in the Blotter) or corrupts FIFO ordering and **silently deletes that round trip's P&L** (garbage strings sort after ISO). | A168 |
| 6 | `rootSym` misses suffixed symbologies (`ESM25-CME`, `MESM25.CME`, `F.US.MESM25`) → $1/pt fallback point value (10–50× wrong price-based P&L; mitigated by the A113 warning) and wrong commission tier downstream. | A168 |
| 7 | `concPct` explodes to an astronomical percentage when wins/losses cancel to float dust: `[+0.1,+0.2,−0.3]` → net `5.6e-17` → **"540431955284459600%"** rendered in Analytics/Reports. | **A170** |
| 8 | `maxDDpct` shows **0.0% "of peak"** for any drawdown that starts at inception (equity never positive — the core audience case): `[−60,−40]` → maxDD $100, badge 0.0%. | A170 |
| 9 | The `known:false` fallback-rate flag is computed but **surfaced nowhere** since the CH16 cutover — estimated commissions (unlisted roots get the $1.50/$0.37 per-side fallback) are indistinguishable from table rates; `exchange-fees.json` covers only 16 roots (no treasuries/grains/most FX). | **A171** |
| 10 | `tierOf`'s M-prefix heuristic misclassifies real CME products absent from the JSON: SIL/2YY/10Y/30Y priced as **standard** (~3× commission overcharge), MWE (full-size wheat) as **micro** (undercharge). Verified against the live tables. | A171 |
| 11 | **"Profit factor" means two different numbers one click apart**: the Reports preview KPI uses gross `m.pf`, the exported Markdown of the same report uses commission-adjusted `c.pf` (2.20 vs 1.38 on the repro set); same for the Net P&L basis (KPI `m.net` vs export `netPreTax`) — contradicting the A156 preview↔download contract. Corroborated independently by two auditors. | **A172** |
| 12 | The Trade Editor accepts **negative qty** → commission becomes a credit (`totalComm −$2.40`, netPreTax > gross, contracts −2); explicit `qty 0` silently bills as 1. Only the manual-edit path (adapters clamp with `Math.abs`). | **A173** |
| 13 | `compute()` trusts input order for `firstDate`/`lastDate`; reversed input yields `spanMonths = −1` → a **negative subscription charge** that inflates net and then gets taxed. Unreachable via live paths today (Store/DemoStore sort) — filed as API hardening with a clamp. | A173 |

## P3 — degenerate cases, labeling, and polish (all reproduced; filed in batches)

- **Metrics conventions (→ A170):** `pf`/`wl` render **∞** for zero-trade/all-scratch sets (an
  untraded month scope shows PF ∞) while `costModel.pf` guards the same case → two PF definitions
  disagree; Sortino shows "—" where PF would show ∞ (no losing days); `maxDDdur` off by one for
  inception drawdowns; `tone(0)='pos'` renders $0.00 **green** where `cls(0)` is neutral;
  `usd(-1e-13)` renders a red **"-$0.00"** from float residue; `usdWhole(±0.4)` sign quirks;
  unknown-side trades silently vanish from the long/short split; dead `ddPeakIdx`/`ddTroughIdx`
  exports (no consumer).
- **Adapters input tolerance (→ A168/A174):** trailing/Unicode minus signs silently dropped
  (sign-flip risk); `1e3` → 13; EU dot-thousands `1.234` → 1.234; impossible dates (`2026-31-31`)
  pass the date gate; substring sniffing over-matches (`Transaction` claims TradingView);
  per-lot cent rounding can drop a cent vs the broker figure (largest-remainder fix); dangling
  opens and multi-lot trade counting are silent design choices worth an import notice/docs;
  `DATE_ORDER` module-global leaks into standalone `normTime` calls (API hygiene).
- **Cost/tax labeling and data (→ A171/A172):** "Net §1256 gain (pre-tax)" taxes
  net-of-subscriptions (subscriptions don't reduce a §1256 gain for a non-TTS filer — the estimate
  understates tax by `fixedPeriod × tEff`; label or docs must match the math);
  `statDetail('net')`'s description says "after commissions … and tax" over a before-costs value;
  TRADOVATE's std tier equals its micro tier (0.35/0.35) — published plans price standard well
  above micro; `rateFor` before `loadRefData` throws (boot awaits it — robustness only).
- **View-model polish (→ A174):** a $0 trade lands in the green `0..50` histogram bucket while the
  W/L bar beside it excludes scratches (two win-rate denominators on one screen: `wins/n` vs
  `wins/(wins+losses)`); histogram edge labels (`>200` is really ≥200); Calendar's "By weekday"
  drops Sunday/Saturday (Globex Sunday sessions are in `monthNet` but absent from the bars);
  `axMoney(999.5)` → "$1000" next to `$1.0k`, and no M tier ("$1500k"); month-scope prior period is
  a rolling equal-length window, not the prior calendar month (unlabeled semantics).

## Verified clean (the load-bearing math — evidence: executed hand-worked cases)

- **`pairFills`** — FIFO sequencing, A115 price-spread apportionment (exact to the broker figure),
  flip fills, partial/multi-fill closes, A114 dup ordinals (stable re-parse → dedupe holds), B25
  same-second tiebreak, A120 DST wall-clock hold time, negative-hold clamp, zero-qty/NaN filters.
- **Commission/tax arithmetic** — per-side tier + exchange fee recomputed by hand across brokers ×
  roots; `Σ bySym.total = totalComm`; 60/40 §1256 blend matches `state-tax.json` + the Howto
  example; tax strictly on positive net; B8 weight normalization; `bePer` per-trade definition.
- **Subscription accrual reconciliation** (the audit's headline question) — `costModel.fixedPeriod`
  and `dailySeries`' month-entry accrual agree exactly on gap-month and year-wrap datasets, on net
  AND take-home, mid-series and endpoint; `dailySeries` taxes the cumulative ("liquidate today")
  base consistently.
- **`compute()` core definitions** — wins/losses/scratch policy (coherent and disclosed in the UI),
  gp/gl/pf/avgW/avgL/wl/expectancy (= net/n, algebraically the standard form), population Sharpe
  labeled "daily · not annualized" and matching the math, Sortino target-0 downside deviation,
  running-peak drawdown and curve indexes, streak counts and dollars, `sessionOf` half-open
  09:30–16:00 edges, `dowBuckets` local-midnight weekday, float accumulation masked by 2-dp display
  everywhere except the F7 gate, empty/one-trade degradation.
- **Tokenizer + `num()` + `normTime` happy paths** — quotes/embedded delimiters/CRLF/BOM, `(…)`
  negatives, EU comma-decimal formats (fixtured), AM/PM incl. 12:0x edge, 2-digit years; sniff
  cross-detection on all nine real header sets.
- **`buildReport`/formatting** — tile↔model equality (A98), A156 title/section toggles, `money()`
  consistent half-up rounding, Dec year-wrap month bounds, `calPnl` single-count per day.

## Fixture gaps → A175

Consolidated across all four auditors: `compute()` has **no dedicated suite** (winRate/pf/expectancy/
drawdown/Sharpe/Sortino/streaks/concPct/sessionOf/long-short are all unfixtured); the P1/P2 repros
above become regression pins; plus a formatting suite (usd/usdWhole/axMoney/ratio/num/fmtDur),
`dailySeries` mid-series assertions, DST-pinned `priorBounds` cases (TZ-forced), `blendedRateFor`/
`spanMonths`/`tierOf`/`rateFor`-fallback units, histogram boundary pack, and adapter fixtures for
every input-tolerance case in A168. Filed as a new `scripts/test-compute.mjs` + targeted additions.

## Method

Four parallel read-only auditors (adapters / compute / cost+tax / series+report+view-models), each
required to reproduce every claim by executing the real modules — several suspected defects did not
reproduce and were dropped by the auditors themselves. The coordinator then independently re-ran
both P1s and the top P2 claims (semicolon import, concPct dust, inception maxDDpct, tierOf
misclassifications, DST prior window under two TZs) before filing. Fix items **A168–A175**; A66
closes with this report as its deliverable.
