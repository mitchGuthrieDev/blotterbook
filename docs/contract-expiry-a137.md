# A137 — Contract expiry-month capture: recommendation

**Date:** 2026-07-05 · **Backlog item:** A137 (discussion/evaluation)

## Recommendation

**Yes — surface expiry, but derive it on read; do not change the adapters or the persisted
schema.** The normalized `Trade` already keeps the raw export symbol verbatim
(`Trade.symbol`, `src/lib/core/types.ts`) while `rootSym()` strips the month code into
`Trade.root` — so the expiry information is **already persisted for every historical trade**
wherever the platform exported it. A small pure helper in the core
(`parseContract(symbol, tradeDate)` — essentially the inverse of the `rootSym()` strip regex,
`/[FGHJKMNQUVXZ]\d{1,4}$/` at `src/lib/core/adapters.ts:89`) recovers `{ monthLetter, month,
year }` at render time. No adapter edits, no IndexedDB migration, no change to
`compute()`/`costModel()`, and it works retroactively on data imported years ago. An optional
`Trade.expiry` field is *not* needed for v1; it stays available as a later additive
optimization (it would be derivable, non-breaking, and excluded from `tradeId`, like
`commission`/`fileIds`).

The main caveat tempering ambition: **the flagship non-beta platform (TradingView) exports
continuous symbols (`CME_MINI:MES1!`) with no expiry at all**, so any expiry UI must degrade
gracefully to "—" and cannot be a headline feature.

## Per-platform coverage (evidence: fixtures in `scripts/test-adapters.mjs`)

| Adapter | Symbol example (fixture) | Contract code present? |
| --- | --- | --- |
| tradingview (balance history) | `CME_MINI:MES1!` (real-shape fixture; synthetic rows use `MESM2025`) | **No** — real exports are continuous (`…1!`) |
| tradingview-orders | `CME_MINI:MES1!` (verified real export, A106) | **No** — continuous |
| motivewave | `MESM2025` | Yes — letter + 4-digit year |
| tradovate | `MESM2025` (Contract col; Product col carries the bare root) | Yes |
| rithmic | `MNQM2025` | Yes |
| sierrachart | `MCLN2025` (real Sierra also `F.US.MESM25` — service prefix) | Yes |
| tradestation | `MESM2025` | Yes |
| webull | `AAPL` (equities) | N/A — no futures expiry |
| ibkr | `TSLA` (fixture is equities; IBKR futures use e.g. `ESZ4`/`MESU5`) | Yes for futures, unverified (beta) |
| schwab / thinkorswim | `/MESM25` | Yes — letter + 2-digit year, `/` prefix |

Net: **7 of 10 formats carry a full contract code**; the two TradingView formats (the only
non-beta adapters, i.e. the bulk of real users today) and Webull do not.

## Parser design sketch

A pure helper in `src/lib/core/core.ts` (exported alongside `sessionOf`/`isoWeek`):

```
parseContract(symbol: string, tradeDate?: string):
  { code: string; month: number; year: number } | null
```

- **Normalize first, exactly like `rootSym()`** (adapters.ts:84–92): uppercase, drop
  exchange prefix (`CME_MINI:`), thinkorswim `/`, CQG/Sierra `F.US.` service prefix, and
  venue suffixes (`-CME`, `.CME`, …) — then match `/([FGHJKMNQUVXZ])(\d{1,4})$/`.
- **Month letter** → month 1–12 via the standard map (F=Jan … Z=Dec).
- **Year digits:** 4 digits → literal (`MESM2025`); 2 digits → `20xx` (`MESM25`); **1 digit**
  (`MESU5`, `ESZ4`) is decade-ambiguous → resolve to the candidate year nearest the trade's
  own `date` (futures list ~1–2 years out, so "closest to trade year, ties toward the
  future" is unambiguous in practice). Without a `tradeDate`, prefer the current decade.
- **Refusals (return `null`):** continuous contracts (`ES1!`, `\d*!$`), bare roots
  (`MES`, `AAPL`), calendar-spread symbols (anything with two month codes or a `-` between
  legs), and — to avoid false positives on equity tickers that happen to end letter+digit —
  optionally gate on the stripped root being futures-plausible (e.g. present in the `POINT`
  table, mirroring the A113 known-root logic). Roots that themselves end in a digit
  (`M2K`, `SR3`, `6E`) are safe: the match anchors on the *trailing* month-letter+digits,
  the same anchor `rootSym()` already strips, so `M2KZ2025`/`SR3M2025` parse correctly.
- **No `Trade` change, no compute/costModel change.** Callers pass `t.symbol` + `t.date`.
  If a persisted field is ever wanted, `expiry?: string` (`"2025-06"`) stamped at import is
  purely additive and outside `tradeId` — existing data derives it lazily.

## Value assessment

- **Per-trade detail (TradeEditor) — high value, trivial cost.** Show "Contract: MES **Jun
  2025** (M25)" when parseable; omit the row otherwise. Best first surface.
- **Blotter column — moderate value.** A compact `M25`-style column next to the root helps
  traders who hold multiple months; must render "—" for TradingView users (most of the
  current base), so it should be secondary/muted, not a default sort key.
- **Expiry-aware grouping / rollover analysis — defer.** Genuinely interesting (P&L by
  contract month, "you traded ESM5 after ESU5 listed as front month", roll-date detection),
  but it only works for the beta fills platforms, needs an expiry-*date* calendar (third
  Friday / business-day rules vary by product: equity index vs. CL vs. GC), and is a real
  analytics feature, not a parser. Not worth building until a beta adapter graduates on
  real exports.

## Proposed backlog items

1. **A137a — `parseContract()` core helper**: pure function + unit tests in a
   `scripts/test-*` suite (month map, 1/2/4-digit years, prefixes/suffixes, `ES1!` and
   spread refusals, decade resolution against trade date). No UI.
2. **A137b — Surface expiry in TradeEditor + Blotter**: detail row and an optional muted
   column, both deriving via A137a from `t.symbol`; graceful "—" fallback.
3. **A137c (deferred, revisit post-beta-graduation) — Rollover analytics**: per-contract
   grouping and roll detection, requires an expiry-date calendar per product family.
