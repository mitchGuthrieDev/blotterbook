# Calculation audit — the five TradingView exports, every upload combination (2026-07-04)

*Owner-directed follow-up to the A66 calc audit: verify the math end-to-end for each way a user
can import the five real TradingView paper-trading exports supplied on 2026-07-04 — one file,
either file, both files in either order, repeats, and include/exclude combinations. Ground truth
is the balance-history export: TradingView records every realized-P&L event exactly, so within its
window it is authoritative by construction. The audit found one real accuracy defect, fixed it
(cross-export reconciliation), and pinned everything with fixtures.*

## The case matrix (after the fix)

| Case | Import | n | Net | Comm (AMP) | Hold cov. | Curve recon. |
|---|---|---|---|---|---|---|
| A | balance only | 50 | **189.75** | 63.60 | 0/50 | ✓ |
| B | orders only | 23 | 410.75 † | 27.90 | 23/23 | ✓ |
| C | balance → orders | 50 | **189.75** | 63.60 | 21/50 | ✓ |
| D | orders → balance | 50 | **189.75** | 63.60 | 21/50 | ✓ |
| E | same file twice (either) | =A/=B | unchanged | unchanged | unchanged | ✓ |
| F | both, orders excluded | 50 | **189.75** | 63.60 | 21/50 | ✓ |
| G | both, balance excluded | 21 | 47.00 | 25.50 | 21/21 | ✓ |

- **C ≡ D exactly** — final trade sets are byte-identical (ids, P&L, enrichment fields,
  provenance) in either import order. The 21 corroborated overlaps dedupe *and* enrich (the
  balance trades gain qty/hold/entry/exit from the orders file).
- **F ≡ A exactly** — excluding the orders file restores the balance-only numbers, while the
  enrichment survives on the trades themselves (exclusion removes *trades*, not learned fields).
- **Idempotence** (E) and **curve↔costModel endpoint reconciliation** hold in every case.
- The journal export refuses via the A178 gate; the positions/orders-all exports (empty files)
  refuse via the intake gates. Nothing non-trade can slip in.

† Case B is *self-consistent* but carries the export's inherent limitation — see below. The
preview's coverage/upgrade hints and the open-lots notice both fire on it.

## The defect the audit found (and the fix)

**Before the fix, Case C/D reported net +553.50 — overstating the true +189.75 by +363.75.**

Root cause, decoded from the raw fills: TradingView's order-history export reaches back ~100
orders. A position open at that boundary makes `pairFills` mispair the earliest round trips — in
this data, the true sequence on 06-17 was *close short +61.25 (14:08:17), open long 14:10:03,
close long +63.75 (14:13:48)*, but the truncated head invented **two phantom shorts** (+271.25
against a real event at the wrong P&L, and +92.50 closing at 14:10:03 where the authoritative
record shows *no realized event at all*) and left the real long dangling as an open lot. Phantom
P&L differs from the real P&L, so the content-hash `tradeId` differs — dedupe alone cannot stop
the double count.

**Fix — cross-export reconciliation** (`reconcileImport` in `src/lib/core/intake.ts`, applied by
`importCsv`/`reimportFile`, scoped to the same platform *family*, e.g. `tradingview` ↔
`tradingview-orders`):

> Inside the time window covered by a same-family **closed** (authoritative) export, a **derived**
> (fills) trade either matches an authoritative record on `time|symbol|side` **with the same
> P&L** — normal dedupe + enrichment — or it is a phantom and is dropped. When the authoritative
> export arrives second, stored derived trades its window doesn't corroborate are evicted first.
> Either order converges to the identical dataset.

Callers without file provenance get a conservative fallback (unambiguous exact-key collisions
only). Other platforms and out-of-window trades are never touched. The import preview states the
resolved count *before* confirm ("N trades disagree with data you've already imported…"), and the
Howto now says: import both — reconciliation is automatic.

**Known trade-off** (accepted, documented): two same-platform accounts imported as
balance-of-account-A + orders-of-account-B would treat B's window-overlapping trades as
unsupported by A's record. The preview count is the guardrail — the user sees the resolution
before confirming. If multi-account support ever lands, the classifier gains an account
dimension.

## Fixtures added

`scripts/test-adapters.mjs` — a synthetic replica of the real case: phantom-mismatch and
phantom-no-event drop inside the window; corroborated and outside-window trades survive; reverse
order evicts the same phantoms (convergence); the no-provenance fallback resolves exact collisions
only; cross-family imports are untouched. (The full-matrix runner against the real files lives in
this audit's history — it depends on local files and is not committed.)

## Verdict

With reconciliation in place, every reachable upload combination of the five exports produces
either the authoritative numbers (any combination involving balance history) or a self-consistent
derived set with its limitations stated up front (orders-only). Commissions price per trade at
dated rates in every case, and the equity-curve endpoint reconciles with the cost panel in all
seven cases.
