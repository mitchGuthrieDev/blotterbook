# Trade Replay — feasibility & effort estimate (R11)

**2026-07-05 · backlog item R11 · status: planning document (no code changes)**

## Verdict

**Feasible with caveats — build in phases, market data last.** A replay experience that steps
through the trader's *own executions* (a fills timeline on a price/time chart) is buildable **now**
from data the exports already carry — the blocker is only that `pairFills()` currently *discards*
fill prices after computing PnL. Full "simulated market snapshots" (candles moving around the
trade) is **not** buildable as a bundled feature: licensed CME intraday data is expensive
(delayed-data licenses alone run ~$304/mo; redistribution needs a distributor agreement), a
static-hosted app has no server to proxy/entitle it, and any hosted candle fetch keyed by
symbol+time range **leaks the user's trading activity to the vendor**, breaking the "no trade data
leaves the browser" promise. Recommended shape: **Phase 1 fills-replay (own data only) → Phase 2
bring-your-own-bar-data (BYOD) import → Phase 3 (optional, consent-gated) user-keyed vendor fetch.**
Never ship Blotterbook-hosted market data.

## What exports carry today (evidence: `src/lib/core/adapters.ts` + `scripts/test-adapters.mjs`)

No platform export carries intra-trade market data — no bars, no ticks, no price path between entry
and exit. What they do carry:

| Platform (adapter) | Kind | Price/time granularity available |
| --- | --- | --- |
| TradingView balance history | closed | Close time + PnL; the `Action` string embeds close price and "Position AVG Price" (avg entry) — currently **unparsed** |
| TradingView order history | fills | Per-order fill price + Placing/Closing time + qty + commission; **Limit/Stop price columns for cancelled/working orders exist but are unparsed** |
| MotiveWave | closed | Entry Time/**Entry Price** + Exit Time/**Exit Price** per row — price columns currently unparsed |
| Tradovate | fills | Fill Time + Avg Fill Price + qty |
| Rithmic R\|Trader | fills | Update Time + Avg Fill Price + Qty Filled |
| Sierra Chart | fills | DateTime + FillPrice + Quantity |
| TradeStation | fills | Date/Time + Price + qty |
| Webull (equities) | fills | Filled Time + Avg Price + qty |
| IBKR Flex/Activity | fills | DateTime + TradePrice + qty + Realized P/L + commission |
| Schwab / thinkorswim | fills | Exec Time + Price + qty (second resolution) |

Key code fact: `Fill` has `price` (`types.ts:58`) but the persisted `Trade` shape
(`types.ts:14-44`) has **no price fields** — `pairFills()` (`adapters.ts:283`) consumes prices into
`pnl` and drops them. So today the store cannot even place a trade on a price axis. Fixing that is
a small, backward-compatible core change (optional `entryPrice`/`exitPrice`, possibly a per-trade
`fills[]` detail array); existing users re-import a CSV and the F37 delta-merge enriches in place.
Timestamps are second-resolution; TradingView balance history has no qty/hold at all (its
`upgradeHint` already points at the order-history export).

## Market-data options (for candles/context beyond the user's own fills)

| Source | Coverage | Cost (order of magnitude) | Licensing | Privacy impact |
| --- | --- | --- | --- | --- |
| [Databento GLBX.MDP3](https://databento.com/datasets/GLBX.MDP3) | Full CME/CBOT/NYMEX/COMEX, tick→1m OHLCV | Usage-based historical (cents per symbol-day for 1m bars); [Standard plan $179/mo](https://databento.com/blog/introducing-new-cme-pricing-plans) | Per-user API key; redistribution NOT allowed on self-serve terms | User-keyed direct fetch: vendor sees symbol+date queries |
| [Polygon.io/Massive futures](https://polygon.io/futures) | CME/CBOT/COMEX/NYMEX aggregates, stable v1 | Tiered plans incl. a free tier ([pricing](https://polygon.io/pricing)) | Per-user key; no redistribution | Same — vendor sees queries |
| [FirstRate Data](https://firstratedata.com/i/futures/ES) / [Kibot](https://www.kibot.com/) / [PortaraCQG](https://portaracqg.com/futures/int/mes) | Downloadable historical 1m bar files (ES 19y, MES 7y) | ~$99.95/yr (FirstRate); one-time per contract | Personal use; we cannot bundle/redistribute | **None if user downloads + imports locally (BYOD)** |
| [CME DataMine / direct license](https://www.cmegroup.com/market-data/license-data.html) | Everything, authoritative | [Delayed-data fee ~$304/mo](https://www.cmegroup.com/market-data/files/january-2026-market-data-fee-list.pdf); distributor + derived-data agreements on top ([2026 changes](https://www.waterstechnology.com/data-management/7952957/cme-rankles-market-data-users-with-licensing-changes)) | Heavy; EOD is no longer free as of 2026 | Hosted redistribution = we become a data distributor — non-starter |
| Yahoo Finance–style free endpoints | ES=F etc. 1m bars, recent window only | Free | Unofficial/against ToS; breaks without notice | Vendor sees queries; unfit to build on |
| User's own platform chart export (Sierra/NinjaTrader/TradingView bar CSV) | Whatever they trade | $0 (they already have it) | Their existing entitlement | **None — pure local import. Best fit for the moat.** |
| [lightweight-charts](https://github.com/tradingview/lightweight-charts) (rendering only) | n/a — chart library, we supply data | Free, Apache 2.0 (+ TradingView attribution notice) | Attribution link required | None; canvas + CSSOM positioning, CSP `style-src 'self'`-compatible |

Honest read: **licensed futures market data is a hard blocker for a free client-side app.**
Bundling it means either eating per-user vendor costs with no backend to enforce entitlement, or a
CME distributor relationship. BYOD sidesteps cost, licensing, *and* the privacy leak; a user-keyed
vendor fetch is an acceptable opt-in only with an explicit "this reveals your symbols/dates to
<vendor>" consent, coarse whole-session (full-day) requests rather than per-trade windows, and
caching so each day is fetched once.

## Storage / perf (client-side, IndexedDB)

- 1-minute OHLCV ≈ 1,380 bars per 23h CME session ≈ 40–60 KB/symbol-day as structured records.
  1,000 trade-days ≈ ~50 MB — comfortably inside Chromium's origin quota and fine for IndexedDB;
  same ballpark as the existing F37 raw-CSV `filetext` store. Store in a new `bars` object store
  keyed `root|date|timeframe`, typed arrays or plain records; evict LRU beyond a user-visible cap.
- 1-second bars ≈ 83k rows/day (~3–5 MB/day) — viable only for a clamped window (e.g. ±2h around
  the trade). **Tick data is out** (GBs/day; also the expensive schema).
- Demo: replay must run off `DemoStore` fixtures — a small canned bar set in `sampledata.ts`; no
  fetch, no persistence (invariant).
- Bundle: lightweight-charts is ~45 KB gz but the `/app/` surface has a fixed JS budget (see
  `check-bundle-size.mjs`'s current `BUDGET_BYTES` — 840 KiB as of A223, raised several times since
  this eval) — lazy-load the replay screen behind a dynamic import regardless of the exact figure.

## UI surface

A **Replay panel** reached from Blotter rows / TradeEditor ("Replay this trade"): price-time chart
(lightweight-charts) with entry/exit markers, per-fill dots for partials/scale-ins, a playback
scrubber (step / play at 1×–60×), and a readout of open position, unrealized P&L (from
`pointValue`), and hold time as the clock advances. Phase 1 renders only the trader's own fills for
the day/session (a "tape of your executions"); Phase 2 fills in candles behind them when bar data
exists for that `root|date`. Fits the existing pattern: a new `src/app/screens/Replay.svelte` (or a
TradeEditor part), state via runes + the prop-drilled Store (from `App.svelte`), no new global state.

## Phased build sketch

| Phase | Scope | Needs | Est. effort |
| --- | --- | --- | --- |
| **1. Fills-timeline replay** | Persist `entryPrice`/`exitPrice` (+ optional `fills[]`) through `pairFills`; parse MotiveWave/TradingView price fields we currently drop; Replay panel plotting the day's own executions with scrubber + running P&L | No external data; small `types.ts`/`adapters.ts`/store change + one screen; adapter fixtures updated | **S–M: ~3–5 days** |
| **2. BYOD bar import** | Bar-CSV adapters (Sierra/NinjaTrader/TradingView export, FirstRate file format), `bars` IndexedDB store + LRU cap, candles behind the Phase-1 chart, demo fixture | lightweight-charts dep (lazy-loaded, attribution), new intake path reusing A177 gates | **M: ~1–2 weeks** |
| **3. User-keyed vendor fetch (optional)** | Opt-in Databento/Polygon key in setup; browser→vendor direct fetch of whole-day 1m bars into the `bars` store; explicit privacy consent + per-day caching; disabled on demo | CSP `connect-src` additions; consent UX; per-vendor response mapping | **M: ~1 week; ship only if owner accepts the privacy trade-off** |
| **✗ Rejected** | Blotterbook-hosted/bundled market data | CME distributor licensing + server infra + egress | Not pursued |

## Open questions for the owner

1. Is Phase 1 (own-executions replay, no candles) valuable enough alone, or is market context the
   whole point? (Determines whether Phase 2 is the real MVP.)
2. Is a user-keyed third-party fetch (Phase 3) acceptable under the privacy promise even as an
   explicit opt-in, or is BYOD-only the line?
3. Should `fills[]` (per-execution detail) become part of the persisted trade record, or do we
   re-derive it from the stored raw CSV (`filetext`, F37) on demand? (Storage vs. recompute.)
4. Bar-store budget: what's the acceptable IndexedDB ceiling before LRU eviction (50 MB? 200 MB?),
   and does it get a Data-manager UI?
5. Is the lightweight-charts dependency + TradingView attribution acceptable, or do we hand-roll
   the candle canvas (more effort, zero deps)?

## Proposed backlog items

- **R11a (feat, S–M):** persist entry/exit prices (+ optional per-trade fills detail) through
  `pairFills()` and the closed-trade adapters that already export prices; enrich on re-import.
- **R11b (feat, M):** Replay panel v1 — own-executions timeline with scrubber + running P&L,
  lazy-loaded; demo-safe via `sampledata.ts` fixtures.
- **R11c (feat, M):** BYOD bar-data import (`bars` store, bar-CSV adapters, candles under the
  replay chart, LRU cap + Data-manager surface).
- **R11d (discussion → feat, gated on Q2):** opt-in user-keyed vendor fetch with consent UX and
  whole-day request granularity.
- **R11e (chore, S):** evaluate lightweight-charts vs. hand-rolled canvas against the current
  bundle budget (`check-bundle-size.mjs`) and CSP; record the choice as a mini-ADR.
