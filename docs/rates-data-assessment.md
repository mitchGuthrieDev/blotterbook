# Rates-data assessment — brokers.json ↔ exchange-fees.json (R21) + effective-dating design (F30)

*2026-07-04 — the R21 discussion deliverable, written alongside the F30/F35 implementation (Phase 3
of the CSV/data-management plan). Settles the relationship between the two rate files, records the
effective-dating schema that shipped, and lists the follow-ups.*

## How the two files relate today

`costModel()` prices a trade's round-turn as **broker commission + exchange composite, × 2 sides ×
qty** (`rateFor()` in `src/lib/core/core.ts`):

- **`brokers.json`** — the *broker-controlled* component: per-side commission by tier
  (`micro`/`std`). Pure commission; no exchange/clearing/NFA content.
- **`exchange-fees.json`** — the *exchange-controlled* component: one composite $ per side per root
  (exchange + clearing + NFA), plus the tier machinery (`micro` list, `notMicro` pins, `fallback`
  rates). Since A171, `tierOf()` consults the explicit lists before the M-prefix heuristic, and
  unknown-root fallback rates are asterisked in the UI (`known:false` → `estimatedCommRoots`).

**Assessment: the split is correct — keep it.** The two components change on different clocks, are
set by different parties, and are cited from different sources. Merging them would couple every
broker row to every root row (~9 × 34 cells) for zero modeling gain. There is no overlap or
duplication between the files; units are consistent ($ per side per contract) and each carries its
own `schemaVersion`.

One nuance worth naming: the composite folds **clearing** into the exchange file, but clearing is
technically *routing*-dependent (e.g. Discount Trading quotes $0.05–$0.45/side varying by
CQG/Rithmic/Teton). At our precision (composites are "snapshot estimates") this is noise; if a
routing-aware model is ever wanted, it's a third small component, not a reshuffle of these two.

## What the research showed (drives the F30 design)

1. **Exchange fees are the volatile, documentable component.** CME adjusts transaction fees roughly
   every February, and brokers republish the changes with exact old→new numbers:
   - **Eff. 2024-02-01** — CME/CBOT equity (ES/NQ/RTY/YM) $1.33→$1.38, NYMEX energy (CL…)
     $1.50→$1.60, COMEX/NYMEX metals (GC/SI…) $1.55→$1.60; all other symbols unchanged.
     *Source: AMP Futures notice — ampfutures.com/news/cme-exchange-fee-increase-effective-february-1-2024.*
   - **Eff. 2025-02-01** — CBOT ag futures (ZC/ZS/ZW) $2.10→$2.13, COMEX micro gold (MGC)
     $0.50→$0.60; explicitly **no change** to CME/CBOT equity incl. micros.
     *Source: AMP Futures notice — ampfutures.com/news/cme-exchange-fee-increase-effective-february-1-2025.*
   - CME publishes historical fee schedules (cmegroup.com/company/clearing-fees/historical-fees.html)
     — the authoritative source for deeper backfill.
2. **Broker commissions are sticky and unarchived.** No 2024–2026 commission-change announcement
   could be found for any broker we list — the published changes were all pass-through CME fee
   increases. So per-broker `rateHistory` ships as a **mechanism** (implemented + tested), with
   entries added only when a change is actually citable. Do **not** fabricate history.
3. **Our composites are `raw CME fee + small adders`** (NFA ~$0.02, sometimes ~$0.05 clearing):
   ES 1.45 ≈ 1.38+0.05+0.02, CL 1.62 ≈ 1.60+0.02, GC 1.67 ≈ 1.60+0.05+0.02. This let the history
   entries be derived from documented deltas. It also exposed **two stale current values** — grains
   ZC/ZS/ZW sat at 2.05 (below even the raw $2.13 fee) and MGC at 0.50 (raw is $0.60 since Feb 2025)
   — **corrected 2026-07-04** to 2.15 and 0.62.

## The effective-dating schema that shipped (both files, v2)

Design principle: **`comm`/`exchange` stay the CURRENT values** — every date-agnostic consumer
(setup UI, Commission Compare, bySym reference rate) reads them unchanged — and history is an
optional, additive list of **closed periods**:

```jsonc
// exchange-fees.json (schemaVersion 2)
"history": [
  { "until": "2024-01-31",              // last day (inclusive) these values applied
    "exchange": { "ES": 1.40, ... },    // PARTIAL: only the roots the documented change moved
    "source": "citation" }
]
// brokers.json (schemaVersion 2)
"AMP": { "comm": {...},                  // current — required, unchanged semantics
         "rateHistory": [ { "until": "...", "comm": {...}, "source": "..." } ] }  // optional
```

Lookup (`rateFor(broker, root, date?)`): scan periods oldest→newest, take the **first entry that
covers the date and lists the root/tier**, else fall through to current. Partial maps make each
entry exactly the documented change — a root absent from a period simply didn't change then.
`costModel()` and `curveseries` price each trade at **its own date** (endpoint reconciliation is
tested); the undated call is byte-identical to the old behavior, so a broker/root with no history
behaves exactly as before (F30's backward-compat requirement).

Rejected alternative: `[{effectiveFrom, comm}]` newest-last replacing `comm` (the F30 sketch) —
it makes the CURRENT rate a derived value and forces every existing consumer through the date
machinery; the `until`-period model keeps the 95% case (no history) zero-cost.

## F35 (shipped alongside)

**Discount Trading** added to `brokers.json` (base tier **$0.20/side micro, $0.49/side standard**;
exchange/clearing/NFA additional; volume tiers go lower) and to `feeds.json` as a `CQG` shared-set
alias (they route CQG/Rithmic/Teton; CME L1 $3–19/mo non-pro).
*Source: discounttrading.com/commission-rates.html (fetched 2026-07-04).*

## Follow-ups

- **Verify the 2026 CME changes are in our composites.** CME published a 2026-02-01 fee schedule and
  announced further changes eff. 2026-04-01. Our current values are a "mid-2026 snapshot" (A171,
  2026-07-02) so they *should* include both — spot-check equity/energy/micro groups against
  cmegroup.com's current schedule; if anything moved, bump current values and push the prior values
  into a `"until": "2026-03-31"` history entry.
- **Backfill deeper exchange-fee history** (pre-2024) from CME's historical-fees page if/when users
  import multi-year-old data; the schema needs no change.
- **Add broker `rateHistory` entries opportunistically** — only with a citable announcement/archive
  (Wayback Machine of a broker's pricing page counts). The mechanism is live and tested.
- **A208 interplay:** trades imported with real CSV commissions bypass the model entirely, so
  historical accuracy matters most for close-event exports (TradingView) that carry no costs.
- **R21 disposition:** keep the two-file split; no restructure. This document closes R21.
