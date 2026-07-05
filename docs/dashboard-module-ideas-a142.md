# Dashboard module ideas — A142 brainstorm

**Date:** 2026-07-05 · **Backlog item:** A142 (DISCUSSION/BRAINSTORM) · **Status:** proposal, no code

Grounding: every idea below uses fields that `compute()` (`src/lib/core/core.ts` → `Metrics`),
`costModel()` (`CostModel`), or `curveseries.dailySeries()` already returns, plus the shared helpers
(`sessionOf`, `isoWeek`, `dowBuckets`, `tagBuckets`, `tone`). Current module set: `perf`, `cal`,
`cost`, `adv`, `compare`. The Analytics screen already owns the histogram + drill-down, underwater
curve, long/short split, hour/weekday bars, per-symbol/per-tag tables, and the advanced-stats grid —
nothing below duplicates those in the same form. Delivery: each idea = a `MODULES` entry + snippet in
`Dashboard.svelte` + an A189 picker thumbnail; "new dashboard" = a preset tab layout (tabs ship).

## Top-5 shortlist

1. **Today / Last Session** — the daily check-in card: latest active day vs your own baselines. (S)
2. **Drawdown Status** — live distance from the high-water mark, framed by the max-DD record. (S)
3. **Streak Monitor** — current win/loss streak (trades + days) vs the historical records. (S)
4. **Rolling Form** — last-20-trades expectancy/win-rate vs all-time: improving or tilting? (S/M)
5. **Session Split (RTH vs ETH)** — the Globex-vs-pit-hours split `sessionOf` already defines. (S)

## Detail

### 1. Today / Last Session — module, effort S
- **Shows:** the most recent active day: net P&L, trades, win rate, best/worst trade of the day, and
  deltas vs baseline ("vs your avg day +$142", "trade count 2× your average"). The first thing a
  day-trader checks.
- **Data:** last entry of `m.days` (`{date,pnl,trades,wins}`), `m.avgDaily`, `m.avgTrades`,
  `m.winDayPct`, `m.bestDay`/`m.worstDay` for context; per-trade rows from `m.trades` filtered to
  `lastDate`.
- **New computation:** none beyond a tail slice — trivial, local.
- **Thumbnail:** a big signed dollar figure over a small "vs avg" delta chip.

### 2. Drawdown Status — module, effort S
- **Shows:** a status card, not a chart (the underwater *curve* stays on Analytics): current
  drawdown $ and % from the high-water mark, "$X to a new equity high", trades since the peak, and
  the max-DD record (`$ / % / duration`) as the yardstick. Recovery factor as a footer stat.
- **Data:** `m.curve` (current DD = running peak − `curve[curve.length-1]` — the peak is already
  walked; one `minMax`-style pass or reuse `m.curve` with a running max), `m.maxDD`, `m.maxDDpct`,
  `m.maxDDdur`, `m.recovery`, `m.ddPeakIdx`/`m.ddTroughIdx`.
- **New computation:** current-DD tail walk over `m.curve` — O(n), cheap.
- **Thumbnail:** an equity line with the peak flagged and a shaded gap down to "now".

### 3. Streak Monitor — module, effort S
- **Shows:** the *current* consecutive-win/loss run in trades and in days, its running $, and how it
  compares to the records (`mcw`/`mcl`, `maxWinStk`/`maxLossStk`). "You're 4 losses deep — your
  record is 6" is exactly the tilt-check traders want mid-week.
- **Data:** `m.mcw`, `m.mcl`, `m.maxWinStk`, `m.maxLossStk`, `m.pnls`, `m.days`.
- **New computation:** walk `m.pnls` (and `m.days`) from the tail until the sign flips — O(streak).
- **Thumbnail:** a row of small green/red squares (recent trades) with the current run highlighted.

### 4. Rolling Form — module, effort S/M
- **Shows:** a momentum read: expectancy, win rate, and net over the last N trades (20 default,
  toggle 50) side-by-side with all-time, plus a rolling-net sparkline. Answers "is my edge
  improving?" without opening Analytics.
- **Data:** `m.pnls` (windowed), all-time `m.expectancy`, `m.winRate`, `m.net` for comparison;
  `linePath`/`niceTicks` for the sparkline.
- **New computation:** one rolling-window pass over `m.pnls` — O(n), local.
- **Thumbnail:** two mini bars (recent vs all-time expectancy) over a sparkline.

### 5. Session Split (RTH vs ETH) — module, effort S
- **Shows:** P&L, trade count, win rate, expectancy per session — regular hours vs Globex/overnight.
  Very futures-specific and absent from Analytics (which buckets by hour, not session). Includes a
  coverage note when timestamps are missing (balance-history exports).
- **Data:** `m.trades` bucketed by `sessionOf(t)` (already in core, node-tested); `tone` for color.
- **New computation:** one bucketing pass — trivial.
- **Thumbnail:** two facing bars labeled RTH / ETH, one green one red.

### 6. Monthly P&L Strip — module, effort S
- **Shows:** the whole history as a compact heat-strip of per-month (toggle: ISO-week) net P&L, with
  best/worst month called out. The `cal` module shows one month; this shows the year shape.
- **Data:** `m.days` grouped by `date.slice(0,7)` (or `isoWeek`); `m.months`; `usdWhole` for cells.
- **New computation:** one grouping pass over `m.days` — cheap.
- **Thumbnail:** a 12-cell green/red strip with one bright cell.

### 7. Tax Reserve — module, effort S
- **Shows:** "set aside $X": net-pre-tax to date, the blended §1256 rate, accrued tax, and after-tax
  take-home — a running reserve figure traders chronically under-plan. Distinct from `cost`'s
  break-even framing; this is the *liability* card.
- **Data:** `costModel` outputs: `netPreTax`, `tEff`, `tax`, `afterTax`, `gross`; `blendedRateFor`.
- **New computation:** none.
- **Thumbnail:** a stacked bar splitting take-home vs tax slice.

### 8. Edge Quality (SQN / Kelly) — module, effort S/M
- **Shows:** a small gauge of system quality: SQN (`√n · expectancy / tStd`), Kelly fraction from
  `winRate` + `wl`, with plain-language bands ("below 1: hard to trade"). Complements the adv grid's
  raw numbers with one interpreted dial.
- **Data:** `m.n`, `m.expectancy`, `m.tStd`, `m.winRate`, `m.wl`, `m.sharpe`/`m.sortino` as footers.
- **New computation:** two closed-form formulas — trivial. Needs a Definitions-panel entry.
- **Thumbnail:** a horizontal gauge with a marker in the mid band.

### New-dashboard (preset tab) idea — "Morning Review" — effort M
Not a new module: a one-click preset tab layout = Today + Streak Monitor + Drawdown Status + `cal`.
Tabs already persist per-tab layouts, so this is a seeding affordance in the picker, not new plumbing.

## Also considered

- **Cost-drag trend** (monthly commissions+fixed vs gross from `dailySeries` gross−net gap) — good, but overlaps `cost`+`compare`; revisit after A203 settles.
- **Guardrails / daily-loss-limit card** (breach count over `m.days` vs a user cap) — valuable but needs a new persisted setting + UX; M/L, park it.
- **Journal coverage nudge** (noted days / `m.active`, `tagBuckets().untagged`) — useful discipline metric; needs journal-store reads in the dashboard VM; M.
- **Best/Worst leaderboard** (`bestDay`/`worstDay`/`best`/`worst`) — already readable from `adv` + Analytics; low marginal value.
- **Profit-concentration card** (`m.concPct`) — one number; belongs in `adv`, not a module.
- **Take-home vs gross gap chart** — the `perf` module's `dailySeries` overlays already show it.
- **Expectancy by qty/size bucket** (`t.qty`) — fills-only coverage makes it niche; Analytics candidate instead.
- **Per-symbol commission table** (`costModel.bySym`) — `cost` already renders this.

## Proposed backlog items (repo style, top 3)

- **id:** A2xx · **title:** Dashboard module: Today / Last Session card · **category:** FEATURE ·
  **priority:** P2 · **effort:** small · **status:** open ·
  **prompt:** Add a `today` module to the Dashboard grid (MODULES entry + snippet + A189 picker
  thumbnail): latest active day from `m.days` — net P&L, trades, win rate, best/worst trade — with
  deltas vs `m.avgDaily`/`m.avgTrades`. Pure tail-slice of existing Metrics; no new core code.
  Demo-safe (read-only). Done when: picker-addable on all surfaces, reconciles with the Calendar
  day cell, node test for the day-slice helper if extracted.

- **id:** A2xx · **title:** Dashboard module: Drawdown Status (high-water-mark card) · **category:**
  FEATURE · **priority:** P2 · **effort:** small · **status:** open ·
  **prompt:** Add a `dd` module: current drawdown $/% from the running peak of `m.curve`, "$X to a
  new high", trades since peak, framed by `m.maxDD`/`maxDDpct`/`maxDDdur` + `m.recovery`. Current-DD
  is a cheap tail walk — put it in core (node-tested) next to the CH23 curve-index fields. Card, not
  a chart (the underwater curve stays on Analytics). MODULES entry + snippet + picker thumbnail.

- **id:** A2xx · **title:** Dashboard module: Streak Monitor · **category:** FEATURE ·
  **priority:** P2 · **effort:** small · **status:** open ·
  **prompt:** Add a `streak` module: current consecutive win/loss run (trades and days, with running
  $) computed by walking `m.pnls`/`m.days` from the tail, shown against the records
  `m.mcw`/`m.mcl`/`m.maxWinStk`/`m.maxLossStk`. Extract the current-streak helper into core beside
  the existing streak accumulation so the two conventions (scratch breaks a run) can't drift;
  node-test it. MODULES entry + snippet + picker thumbnail.
