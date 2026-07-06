# CSV import → adapters pipeline

How a raw balance-history CSV is sniffed to a platform, parsed by the matching adapter, and (for
execution-level exports) round-trip matched into normalized closed trades before persistence.

**Source of truth:** [`src/lib/core/adapters.ts`](../../src/lib/core/adapters.ts) ·
[`src/lib/core/store.ts`](../../src/lib/core/store.ts) (`addTrades`, `tradeId`) ·
[`src/lib/core/types.ts`](../../src/lib/core/types.ts) (`Trade` / `Fill`).

```mermaid
flowchart TD
    XLSX["ATAS X .xlsx workbook"] -->|"isXlsxFile() route (F52)"| X2C["atasXlsxToCsv()<br/>src/lib/core/xlsx.ts — dependency-free ZIP+OOXML read"]
    X2C --> CSV
    CSV["CSV text<br/>(TradingView, Tradovate/NinjaTrader, Quantower, Rithmic, …)"] --> DET["Adapters.detect()<br/>run every adapter.sniff() → score<br/>best score at/above that adapter's minScore (3-5) wins (A178)"]
    DET -->|"no adapter clears its minScore / parse fail"| ERR["ParseResult.ok = false<br/>error surfaced to UI"]
    DET -->|"platform"| PARSE["Adapters.parse(text, platformId)"]

    PARSE --> KIND{"adapter.kind"}
    KIND -->|"closed"| CLOSED["toTrades()<br/>each row = finished position<br/>tradingview · motivewave · tradovate-perf · atas"]
    KIND -->|"fills"| FILLS["toTrades() → Fill[]<br/>tradingview-orders · tradovate · tradovate-fills · quantower ·<br/>rithmic · sierrachart · tradestation · webull · ibkr · schwab"]

    FILLS --> PAIR["pairFills(fills)<br/>FIFO round-trip per symbol · flips/partials<br/>_seq tiebreak in same-second batches<br/>apportion broker realized by spread (A115)<br/>fallback (exit−entry)×qty×pointValue(root)<br/>unknown root → pvEstimated (A113)"]

    CLOSED --> NORM["normalized Trade[]<br/>time · date · pnl · symbol · root · side ·<br/>qty? · entryTime? · exitTime? · holdMs? · commission?<br/>dup? · pvEstimated?"]
    PAIR --> NORM

    NORM --> RECON["reconcileImport()<br/>src/lib/core/intake.ts — cross-export authority/derived-peer<br/>resolution drops phantom fills-derived round trips (A219)"]
    RECON --> ADD["Store.addTrades(trades)<br/>dedupe by tradeId (FNV-1a hash) ·<br/>delta-merge into IndexedDB (one readwrite tx)"]
    ADD --> BUS["emit data:imported {added, dup}"]
```

## Adapters

| Adapter | Kind | Status |
| --- | --- | --- |
| `tradingview` | closed | production (verified) |
| `tradingview-orders` | fills | production (verified) |
| `tradovate` (orders), `tradovate-perf`, `tradovate-fills` — Tradovate/NinjaTrader family | fills / closed / fills | production (verified, A209) |
| `quantower` | fills | production (verified, A209) |
| `atas` — ATAS X (.xlsx statistics export routed through `xlsx.ts`, F52) | closed | production (verified, A209/F52) |
| `motivewave` | closed | beta |
| `rithmic`, `sierrachart`, `tradestation`, `webull`, `ibkr`, `schwab` | fills | beta |

- **closed** exports carry realized PnL per row; **fills** exports are individual executions that
  `pairFills()` turns into closed trades via a FIFO round-trip matcher.
- Every adapter emits the **same normalized `Trade` shape**, so `compute()`/`costModel()` never
  change when a platform is added — the whole reason the seam exists (add an adapter = one object in
  `adapters.ts` + a fixture in `scripts/test-adapters.mjs`).
- **Dedupe** is content-addressed: `tradeId = FNV-1a(time|symbol|side|pnl[|dup])`, so re-uploading an
  overlapping CSV only inserts genuinely new rows. **Cross-export reconciliation** (`reconcileImport`,
  A219) additionally drops fills-derived phantom trades when a same-platform-family closed export
  proves they never happened (see `docs/data-flow.md` / the 2026-07-04 calc audit in `docs/archive/`).
- **7 of 14 adapters remain `beta:true`** (built from documented formats + synthetic fixtures, not yet
  verified against a real export) — see backlog **A103**.
