# CSV import → adapters pipeline

How a raw balance-history CSV is sniffed to a platform, parsed by the matching adapter, and (for
execution-level exports) round-trip matched into normalized closed trades before persistence.

**Source of truth:** [`src/lib/core/adapters.ts`](../../src/lib/core/adapters.ts) ·
[`src/lib/core/store.ts`](../../src/lib/core/store.ts) (`addTrades`, `tradeId`) ·
[`src/lib/core/types.ts`](../../src/lib/core/types.ts) (`Trade` / `Fill`).

```mermaid
flowchart TD
    CSV["CSV text<br/>(TradingView, Tradovate, Rithmic, …)"] --> DET["Adapters.detect()<br/>run every adapter.sniff() → score<br/>best score ≥ 2 wins"]
    DET -->|"no adapter ≥ 2 / parse fail"| ERR["ParseResult.ok = false<br/>error surfaced to UI"]
    DET -->|"platform"| PARSE["Adapters.parse(text, platformId)"]

    PARSE --> KIND{"adapter.kind"}
    KIND -->|"closed"| CLOSED["toTrades()<br/>each row = finished position<br/>tradingview · motivewave"]
    KIND -->|"fills"| FILLS["toTrades() → Fill[]<br/>tradovate · rithmic · sierrachart ·<br/>tradestation · webull · ibkr · schwab"]

    FILLS --> PAIR["pairFills(fills)<br/>FIFO round-trip per symbol · flips/partials<br/>_seq tiebreak in same-second batches<br/>apportion broker realized by spread (A115)<br/>fallback (exit−entry)×qty×pointValue(root)<br/>unknown root → pvEstimated (A113)"]

    CLOSED --> NORM["normalized Trade[]<br/>time · date · pnl · symbol · root · side ·<br/>qty? · entryTime? · exitTime? · holdMs? ·<br/>dup? · pvEstimated?"]
    PAIR --> NORM

    NORM --> ADD["Store.addTrades(trades)<br/>dedupe by tradeId (FNV-1a hash) ·<br/>delta-merge into IndexedDB (one readwrite tx)"]
    ADD --> BUS["emit data:imported {added, dup}"]
```

## Adapters

| Adapter | Kind | Status |
| --- | --- | --- |
| `tradingview` | closed | production |
| `motivewave` | closed | beta |
| `tradovate`, `rithmic`, `sierrachart`, `tradestation`, `webull`, `ibkr`, `schwab` | fills | beta |

- **closed** exports carry realized PnL per row; **fills** exports are individual executions that
  `pairFills()` turns into closed trades via a FIFO round-trip matcher.
- Every adapter emits the **same normalized `Trade` shape**, so `compute()`/`costModel()` never
  change when a platform is added — the whole reason the seam exists (add an adapter = one object in
  `adapters.ts` + a fixture in `scripts/test-adapters.mjs`).
- **Dedupe** is content-addressed: `tradeId = FNV-1a(time|symbol|side|pnl[|dup])`, so re-uploading an
  overlapping CSV only inserts genuinely new rows.
