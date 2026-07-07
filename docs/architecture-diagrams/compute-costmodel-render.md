# Compute → cost model → render pipeline

How persisted trades flow through filtering, metric computation, the cost/tax model, the equity
curve series, and the report builder into the reactive screens.

**Source of truth:** [`src/lib/core/core.ts`](../../src/lib/core/core.ts) (`compute`, `costModel`,
`rateFor`) · [`src/lib/core/curveseries.ts`](../../src/lib/core/curveseries.ts) (`dailySeries`) ·
[`src/lib/core/report.ts`](../../src/lib/core/report.ts) · [`src/app/lib/dashboard.svelte.ts`](../../src/app/lib/dashboard.svelte.ts).

```mermaid
flowchart TD
    STORE[("Store — trades")] --> ALL["allTrades ($state)"]
    ALL --> FILT["applyFilters()<br/>root · side · session · date · tag · dows · scope"]
    FILT --> FILTERED["filtered ($derived)"]

    FILTERED --> COMPUTE["compute(trades) → Metrics<br/>n · net · winRate · pf · expectancy ·<br/>maxDD/% · curve[] · days[] · streaks ·<br/>sharpe/sortino · long/short · best/worst dow"]

    SETUP["setup: broker · feed · state · platform<br/>→ CostInputs"] --> COST
    COMPUTE --> COST["costModel(metrics, inputs) → CostModel<br/>totalComm = rateFor(broker,root).rate×2×qty ·<br/>fixedPeriod = fixedMo × months (A117) ·<br/>netPreTax · tEff · tax (§1256) · afterTax ·<br/>bySym[] · bePer"]

    COMPUTE --> CURVE["dailySeries(metrics) → DailyPoint[]<br/>cumulative gross / net / take per day<br/>(endpoint reconciles to costModel)"]
    COMPUTE --> REPORT["buildReport(m, cost, labels)<br/>headline tiles + costRows + statsRows +<br/>commRows → reportText / reportMd / mailto"]
    REPORT --> REPORTSCREEN["Reports.svelte renders the report VM<br/>(buildReportVM, reports.ts)"]
    REPORTSCREEN -->|"onexport('pdf')"| PRINT["onReportExport() → window.print()<br/>(App.svelte) — no standalone HTML doc builder"]

    COMPUTE --> RENDER["Svelte screens (reactive $derived)<br/>Dashboard · Analytics · Reports · Calendar"]
    COST --> RENDER
    CURVE --> RENDER
```

## Notes

- **`compute()` is pure** — trades in, a ~35-field `Metrics` object out (counts, PnL totals, ratios,
  realized drawdown, equity `curve[]`, per-day aggregates, streaks, daily Sharpe/Sortino, side splits,
  day-of-week extremes). No framework, node-tested.
- **`costModel()`** layers real-world costs on top: round-turn commissions (`rate × 2 × qty` via
  `rateFor(broker, root)` against the reference-data fee tables), fixed monthly subscriptions accrued
  across **every** calendar month spanned (not just active ones — A117), a §1256 + state blended tax
  estimate, and a per-symbol commission breakdown.
- **`dailySeries()`** shares the same commission/subscription/tax math so the curve's endpoint
  reconciles exactly with `costModel.netPreTax`/`afterTax` (guarded by the `curveandreport` suite).
- Screens hold **no business logic** — they render `$derived` views of these pure outputs.
- **`report.ts` exports only `buildReport()`** — there is no `reportHtmlDoc()`/standalone-HTML builder
  in the pure core. PDF export is `window.print()` on the already-rendered `Reports` screen
  (`Reports.svelte` → `buildReportVM` in `src/app/lib/reports.ts` → `App.svelte`'s `onReportExport`,
  invoked via the `onexport` callback with `kind === 'pdf'`).
